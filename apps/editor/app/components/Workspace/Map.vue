<script setup lang="ts">
import { computed, ref } from "vue";
import { useWorkspaceDockLayout } from "../../composables/use-workspace-dock-layout";

const props = defineProps<{
  state: any;
  tilesets: any[];
  activeLayer: any;
  activeLayerId: string | null;
  selectedTile: any;
  selectedMetatileId: string | null;
  selectedPrefabId: string | null;
  metatileMode?: "tiles" | "collision";
  selectedEntityDefinitionId: string;
  selectedEntityDefinition: any;
  entityDefinitions: any[];
  historyEntries: any[];
  historyIndex: number;
  selection: any;
  selectedItem: any;
  showGrid: boolean;
  showFootprints: boolean;
  flipX: boolean;
  flipY: boolean;
  brushSpacing: number;
  activeTool: string;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
}>();
const emit = defineEmits(["rename-project", "select-prefab", "select-map-metatile", "error", "zoom-change", "paint", "action", "stroke-start", "stroke-end", "update:active-tool", "undo", "redo", "update:active-layer-id", "toggle-layer-visibility", "move-layer", "add-layer", "delete-active-layer", "select-scene-entity", "edit-entity-definition", "update:show-grid", "update:show-footprints", "update:flip-x", "update:flip-y", "update:brush-spacing", "clear-active-layer", "update:selected-entity-definition-id", "create-entity-definition", "patch-active-layer", "go-to-history", "patch-selection", "delete-selection"]);

const panels = [
  { id: "project", label: "Project", class: "project-panel" },
  { id: "prefabs", label: "Prefabs" },
  { id: "metatiles", label: "Metatiles" },
  { id: "outliner", label: "Outliner" },
  { id: "view", label: "View" },
  { id: "placement", label: "Entity placement" },
  { id: "properties", label: "Properties" },
  { id: "history", label: "History", class: "history-panel" },
  { id: "selection", label: "Selection" },
];
const layout = useWorkspaceDockLayout("bonka.workspace-layout.map.v2", {
  left: [{ key: "project", tabs: ["project"] }, { key: "resources", tabs: ["prefabs", "metatiles"] }],
  right: panels.slice(3).map(panel => ({ key: panel.id, tabs: [panel.id] })),
});
const scene = computed(() => props.state?.scene ?? {});
const selectedDefinition = computed(() => props.entityDefinitions.find(definition => definition.id === props.selectedEntityDefinitionId));
const sceneCanvas = ref<any>(null);
defineExpose({ zoomOut: () => sceneCanvas.value?.zoomOut(), zoomIn: () => sceneCanvas.value?.zoomIn(), setZoom: (value: number) => sceneCanvas.value?.setZoom(value), resetView: () => sceneCanvas.value?.resetView(), fitView: () => sceneCanvas.value?.fitView() });
</script>

<template>
  <section class="workspace-layout map-workspace" aria-label="Map workspace">
    <WorkspaceDocks :panels="panels" :layout="layout" left-label="Project resources" right-label="Layers and properties">
      <template #project>
        <label class="field field-stack" for="project-name"><span>Project name</span><PillEditor id="project-name" :model-value="state?.projectName ?? ''" aria-label="Project name" @change="emit('rename-project', $event)" /></label>
        <dl class="project-metrics"><div class="project-metric"><dt>Tilesets</dt><dd>{{ tilesets.length }}</dd></div><div class="project-metric"><dt>Metatiles</dt><dd>{{ state?.metatiles.length ?? 0 }}</dd></div><div class="project-metric"><dt>Prefabs</dt><dd>{{ state?.prefabs.length ?? 0 }}</dd></div></dl>
        <dl class="scene-metrics"><div class="scene-metric"><dt>Map size</dt><dd>{{ scene.width ?? 0 }}x{{ scene.height ?? 0 }} tiles</dd></div><div class="scene-metric"><dt>Tile size</dt><dd>{{ scene.tileWidth ?? 0 }}x{{ scene.tileHeight ?? 0 }} px</dd></div><div class="scene-metric"><dt>Grid size</dt><dd>{{ scene.gridWidth ?? 0 }}x{{ scene.gridHeight ?? 0 }} px</dd></div></dl>
      </template>
      <template #prefabs><PrefabPanel :prefabs="state?.prefabs ?? []" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-prefab-id="selectedPrefabId" :selected-metatile-id="selectedMetatileId" :busy="busy" @select="emit('select-prefab', $event)" /></template>
      <template #metatiles><MetatilePanel :show-editor="false" :show-controls="false" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :tile-selection="selectedTile" :mode="metatileMode ?? 'tiles'" :busy="busy" @select="emit('select-map-metatile', $event)" @error="emit('error', $event)" /></template>
      <template #outliner>
        <LayerList :layers="state?.layers ?? []" :active-layer-id="activeLayerId" @select="emit('update:active-layer-id', $event)" @toggle-visibility="emit('toggle-layer-visibility', $event)" @move="emit('move-layer', $event)" />
        <div class="layer-actions outliner-actions"><button class="action" type="button" @click="emit('add-layer', 'tile')">Add tile layer</button><button class="action" type="button" @click="emit('add-layer', 'object')">Add object layer</button><button class="action" type="button" @click="emit('add-layer', 'group')">Add group</button><button class="action danger" type="button" :disabled="!activeLayer" @click="emit('delete-active-layer')">Delete layer</button></div>
        <SceneEntityList :entities="state?.entities ?? []" :definitions="entityDefinitions" :selected-id="selection?.kind === 'entity' ? selection.id : null" @select="emit('select-scene-entity', $event)" @edit="emit('edit-entity-definition', $event)" />
      </template>
      <template #view><ViewPanel :show-grid="showGrid" :show-footprints="showFootprints" :flip-x="flipX" :flip-y="flipY" :brush-spacing="brushSpacing" :can-clear="Boolean(activeLayer && activeLayer.type !== 'group')" @update:show-grid="emit('update:show-grid', $event)" @update:show-footprints="emit('update:show-footprints', $event)" @update:flip-x="emit('update:flip-x', $event)" @update:flip-y="emit('update:flip-y', $event)" @update:brush-spacing="emit('update:brush-spacing', $event)" @clear="emit('clear-active-layer')" /></template>
      <template #placement><label class="field field-stack" for="entity-definition"><span>Placement definition</span><PillEditor id="entity-definition" :model-value="selectedEntityDefinitionId" aria-label="Placement definition" :options="[{ label: 'Choose a definition', value: '' }, ...entityDefinitions.map(definition => ({ label: definition.name, value: definition.id }))]" @change="emit('update:selected-entity-definition-id', String($event))" /></label><div class="inline-actions"><button class="action" type="button" @click="emit('create-entity-definition')">New definition</button><button class="action" type="button" :disabled="!selectedDefinition" @click="selectedDefinition && emit('edit-entity-definition', selectedDefinition.id)">Edit definition</button></div></template>
      <template #properties><LayerPropertiesPanel :layer="activeLayer" @patch="emit('patch-active-layer', $event)" /></template>
      <template #history><HistoryPanel :entries="historyEntries" :current-index="historyIndex" @go-to="emit('go-to-history', $event)" /></template>
      <template #selection><SelectionPanel :selection="selectedItem" :entity-definitions="entityDefinitions" @patch="emit('patch-selection', $event)" @remove="emit('delete-selection')" /></template>
    </WorkspaceDocks>
    <SceneCanvas ref="sceneCanvas" class="workspace-region--main" :state="state" :show-grid="showGrid" :show-footprints="showFootprints" :active-layer-id="activeLayerId" :selected-metatile-id="selectedMetatileId" :flip-x="flipX" :flip-y="flipY" :can-undo="canUndo" :can-redo="canRedo" :active-tool="activeTool" :selection="selection" :brush-spacing="brushSpacing" @error="emit('error', $event)" @zoom-change="emit('zoom-change', $event)" @paint="emit('paint', $event)" @action="emit('action', $event)" @stroke-start="emit('stroke-start', $event)" @stroke-end="emit('stroke-end', $event)" @update:active-tool="emit('update:active-tool', $event)" @undo="emit('undo')" @redo="emit('redo')" />
  </section>
</template>
