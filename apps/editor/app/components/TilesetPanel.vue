<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  tilesets: any[];
  selectedTile: { tileset: string; tile: number } | null;
  busy: boolean;
}>();
const emit = defineEmits<{
  import: [files: File[]];
  "select-tile": [selection: { tileset: string; tile: number }];
  error: [message: string];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const search = ref("");
const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  return props.tilesets.flatMap((tileset, index) => {
    const tiles = Array.from({ length: tileset.tileCount }, (_, tile) => tile).filter(tile => !query ||
      tileset.name.toLowerCase().includes(query) ||
      tileset.id.toLowerCase().includes(query) ||
      `tile ${tile}`.includes(query));
    return tiles.length ? [{ tileset, tiles, index }] : [];
  });
});

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if(files.length) emit("import", files);
}

function isSelectedTile(tileset: string, tile: number) {
  return props.selectedTile?.tileset === tileset && props.selectedTile.tile === tile;
}

function isSelectedTileset(tileset: string) {
  return props.selectedTile?.tileset === tileset;
}
</script>

<template>
  <EditorPanel title="Tileset" class="tileset-panel">
    <div class="palette-controls">
      <label class="visually-hidden" for="tile-search">Search tiles</label>
      <input id="tile-search" v-model="search" class="search" type="search" placeholder="Search tiles" autocomplete="off">
      <button class="action" type="button" :disabled="busy" @click="fileInput?.click()">Import PNG</button>
      <input ref="fileInput" type="file" accept="image/png,.png" multiple hidden @change="selectFiles">
    </div>
    <div class="tile-palette" role="listbox" aria-label="Tile palette" tabindex="0">
      <p v-if="!groups.length" class="empty-note">{{ tilesets.length ? "No tiles match the search." : "Import a PNG tileset to fill the palette." }}</p>
      <details v-for="group in groups" :key="group.tileset.id" class="tile-group" :open="search.trim() || isSelectedTileset(group.tileset.id) || (group.index === 0 && tilesets.length < 8)">
        <summary>{{ group.tileset.name }} ({{ group.tiles.length }})</summary>
        <div class="tile-group-grid" :style="{ '--tileset-columns': String(group.tileset.columns) }">
          <button v-for="tile in group.tiles" :key="tile" class="preview-button tile-preview" :class="{ selected: isSelectedTile(group.tileset.id, tile) }" type="button" :title="`${group.tileset.name} / tile ${tile}`" :aria-label="`${group.tileset.name} / tile ${tile}`" @click="emit('select-tile', { tileset: group.tileset.id, tile })">
            <TilePreview :tileset="group.tileset" :tile="tile" @error="emit('error', $event)" />
          </button>
        </div>
      </details>
    </div>
  </EditorPanel>
</template>
