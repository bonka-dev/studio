<script setup lang="ts">
import { computed } from "vue";
import { useWorkspaceDockLayout } from "../../composables/use-workspace-dock-layout";

const props = defineProps<{ state: any; tilesets: any[]; selectedTile: any; selectedMetatileId: string | null; selectedPrefabId: string | null; metatileMode: "tiles" | "collision"; busy: boolean }>();
const emit = defineEmits(["add-metatile", "select-metatile", "activate-metatile-cell", "update:metatile-mode", "error", "import-tilesets", "select-tileset", "rename-tileset", "remove-tileset", "select-tile", "add-prefab", "select-prefab", "activate-prefab-cell"]);
const layout = useWorkspaceDockLayout("bonka.workspace-layout.tiles.v1", { left: [{ key: "editor", tabs: ["editor"] }, { key: "tilesets", tabs: ["tilesets"] }, { key: "metatiles", tabs: ["metatiles"] }], right: [{ key: "prefabs", tabs: ["prefabs"] }] });
const panels = [{ id: "tilesets", label: "Tilesets" }, { id: "editor", label: "Metatile editor" }, { id: "metatiles", label: "Metatiles", class: "metatile-panel" }, { id: "prefabs", label: "Prefabs", class: "prefab-panel" }];
const selectedTileset = computed(() => props.tilesets.find(tileset => tileset.id === props.selectedTile?.tileset) ?? null);
</script>

<template>
  <section class="workspace-layout tiles-workspace" aria-label="Tiles workspace">
    <WorkspaceDocks :panels="panels" :layout="layout" left-label="Tilesets and metatiles" right-label="Prefabs">
      <template #tilesets><TilesetLibraryPanel :tilesets="tilesets" :selected-id="selectedTile?.tileset ?? null" :busy="busy" @import="emit('import-tilesets', $event)" @select="emit('select-tileset', $event)" @rename="(id, name) => emit('rename-tileset', id, name)" @remove="emit('remove-tileset', $event)" /></template>
      <template #editor><MetatilePanel compact :show-library="false" :show-controls="false" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :tile-selection="selectedTile" :mode="metatileMode" :busy="busy" @add="emit('add-metatile', $event)" @select="emit('select-metatile', $event)" @activate-cell="emit('activate-metatile-cell', $event)" @update:mode="emit('update:metatile-mode', $event)" @error="emit('error', $event)" /></template>
      <template #metatiles><MetatilePanel :show-editor="false" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :tile-selection="selectedTile" :mode="metatileMode" :busy="busy" @add="emit('add-metatile', $event)" @select="emit('select-metatile', $event)" @activate-cell="emit('activate-metatile-cell', $event)" @update:mode="emit('update:metatile-mode', $event)" @error="emit('error', $event)" /></template>
      <template #prefabs><PrefabPanel editable :prefabs="state?.prefabs ?? []" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-prefab-id="selectedPrefabId" :selected-metatile-id="selectedMetatileId" :busy="busy" @add="emit('add-prefab', $event)" @select="emit('select-prefab', $event)" @activate-cell="emit('activate-prefab-cell', $event)" /></template>
    </WorkspaceDocks>
    <EditorPanel :title="selectedTileset ? `${selectedTileset.name} tiles` : 'Tiles'" class="workspace-region--main tiles-workspace-panel" :collapsible="false">
      <TilesetPanel :tileset="selectedTileset" :selection="selectedTile" :max-columns="state?.metatiles.find((item: any) => item.id === selectedMetatileId)?.columns ?? 1" :max-rows="state?.metatiles.find((item: any) => item.id === selectedMetatileId)?.rows ?? 1" @select="emit('select-tile', $event)" />
    </EditorPanel>
  </section>
</template>
