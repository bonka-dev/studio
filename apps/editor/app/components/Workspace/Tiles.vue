<script setup lang="ts">
import { ref } from "vue";
import { useWorkspaceDockLayout } from "../../composables/use-workspace-dock-layout";

defineProps<{ state: any; tilesets: any[]; selectedTile: any; selectedMetatileId: string | null; selectedPrefabId: string | null; metatileMode: "tiles" | "collision"; busy: boolean }>();
const emit = defineEmits(["add-metatile", "select-metatile", "activate-metatile-cell", "update:metatile-mode", "error", "import-tilesets", "select-tile", "add-prefab", "select-prefab", "activate-prefab-cell"]);
const activeView = ref<"tilesets" | "metatile">("tilesets");
const layout = useWorkspaceDockLayout("bonka.workspace-layout.tiles.v1", { left: [{ key: "metatiles", tabs: ["metatiles"] }], right: [{ key: "prefabs", tabs: ["prefabs"] }] });
const panels = [{ id: "metatiles", label: "Metatiles", class: "metatile-panel" }, { id: "prefabs", label: "Prefabs", class: "prefab-panel" }];
</script>

<template>
  <section class="workspace-layout tiles-workspace" aria-label="Tiles workspace">
    <WorkspaceDocks :panels="panels" :layout="layout" left-label="Metatiles" right-label="Prefabs">
      <template #metatiles><MetatilePanel :show-editor="false" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :tile-selection="selectedTile" :mode="metatileMode" :busy="busy" @add="emit('add-metatile', $event)" @select="emit('select-metatile', $event)" @activate-cell="emit('activate-metatile-cell', $event)" @update:mode="emit('update:metatile-mode', $event)" @error="emit('error', $event)" /></template>
      <template #prefabs><PrefabPanel editable :prefabs="state?.prefabs ?? []" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-prefab-id="selectedPrefabId" :selected-metatile-id="selectedMetatileId" :busy="busy" @add="emit('add-prefab', $event)" @select="emit('select-prefab', $event)" @activate-cell="emit('activate-prefab-cell', $event)" /></template>
    </WorkspaceDocks>
    <EditorPanel title="Tiles" class="workspace-region--main tiles-workspace-panel" :tabs="[{ id: 'tilesets', label: 'Tilesets' }, { id: 'metatile', label: 'Metatile editor' }]" :active-tab="activeView" @update:active-tab="activeView = $event as 'tilesets' | 'metatile'">
      <TilesetPanel v-if="activeView === 'tilesets'" :tilesets="tilesets" :selection="selectedTile" :max-columns="state?.metatiles.find((item: any) => item.id === selectedMetatileId)?.columns ?? 1" :max-rows="state?.metatiles.find((item: any) => item.id === selectedMetatileId)?.rows ?? 1" :busy="busy" @import="emit('import-tilesets', $event)" @select="emit('select-tile', $event)" @error="emit('error', $event)" />
      <MetatilePanel v-else :show-library="false" :metatiles="state?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :tile-selection="selectedTile" :mode="metatileMode" :busy="busy" @add="emit('add-metatile', $event)" @select="emit('select-metatile', $event)" @activate-cell="emit('activate-metatile-cell', $event)" @update:mode="emit('update:metatile-mode', $event)" @error="emit('error', $event)" />
    </EditorPanel>
  </section>
</template>
