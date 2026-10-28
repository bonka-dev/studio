<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  tilesets: any[];
  selection: { tileset: string; startTile: number; columns: number; rows: number } | null;
  maxColumns: number;
  maxRows: number;
  busy: boolean;
  headerless?: boolean;
}>();
const emit = defineEmits<{
  import: [files: File[]];
  select: [selection: { tileset: string; startTile: number; columns: number; rows: number }];
  error: [message: string];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const search = ref("");
const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  return props.tilesets.flatMap((tileset, index) => {
    const matches = !query || tileset.name.toLowerCase().includes(query) || tileset.id.toLowerCase().includes(query);
    return matches ? [{ tileset, index }] : [];
  });
});

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if(files.length) emit("import", files);
}

function isSelectedTileset(tileset: string) {
  return props.selection?.tileset === tileset;
}

const dragStart = ref<{ tileset: string; tile: number } | null>(null);

function selectionFor(tileset: any, first: number, last: number) {
  const firstX = first % tileset.columns;
  const firstY = Math.floor(first / tileset.columns);
  const lastX = last % tileset.columns;
  const lastY = Math.floor(last / tileset.columns);
  const columns = Math.min(Math.abs(lastX - firstX) + 1, Math.max(1, props.maxColumns));
  const rows = Math.min(Math.abs(lastY - firstY) + 1, Math.max(1, props.maxRows));
  const startX = lastX >= firstX ? firstX : firstX - columns + 1;
  const startY = lastY >= firstY ? firstY : firstY - rows + 1;
  return { tileset: tileset.id, startTile: Math.max(0, startY) * tileset.columns + Math.max(0, startX), columns, rows };
}

function beginSelection(event: PointerEvent, tileset: any, tile: number) {
  dragStart.value = { tileset: tileset.id, tile };
  emit("select", selectionFor(tileset, tile, tile));
}

function extendSelection(tileset: any, tile: number) {
  if(dragStart.value?.tileset !== tileset.id) return;
  emit("select", selectionFor(tileset, dragStart.value.tile, tile));
}

function endSelection() {
  dragStart.value = null;
}
</script>

<template>
  <EditorPanel title="Tileset" class="tileset-panel" :headerless="headerless">
    <div class="palette-controls">
      <label class="visually-hidden" for="tile-search">Search tiles</label>
      <input id="tile-search" v-model="search" class="search" type="search" placeholder="Search tiles" autocomplete="off">
      <button class="action" type="button" :disabled="busy" @click="fileInput?.click()">Import PNG</button>
      <input ref="fileInput" type="file" accept="image/png,.png" multiple hidden @change="selectFiles">
    </div>
    <div class="tile-palette" role="listbox" aria-label="Tile palette" tabindex="0">
      <p v-if="!groups.length" class="empty-note">{{ tilesets.length ? "No tiles match the search." : "Import a PNG tileset to fill the palette." }}</p>
      <details v-for="group in groups" :key="group.tileset.id" class="tile-group" :open="search.trim() || isSelectedTileset(group.tileset.id) || (group.index === 0 && tilesets.length < 8)">
        <summary>{{ group.tileset.name }} ({{ group.tileset.tileCount }})</summary>
        <div class="tileset-image-picker" :style="{ '--tileset-columns': String(group.tileset.columns), '--tileset-rows': String(Math.ceil(group.tileset.tileCount / group.tileset.columns)) }">
          <img :src="group.tileset.image" :alt="`${group.tileset.name} tileset`">
          <div class="tileset-hit-grid" role="grid" :aria-label="`${group.tileset.name} tile selection`">
            <button v-for="tile in group.tileset.tileCount" :key="tile - 1" class="tileset-hitbox" :class="{ selected: selection?.tileset === group.tileset.id && tile - 1 >= selection.startTile && tile - 1 < selection.startTile + selection.rows * group.tileset.columns && (tile - 1) % group.tileset.columns >= selection.startTile % group.tileset.columns && (tile - 1) % group.tileset.columns < selection.startTile % group.tileset.columns + selection.columns }" type="button" :aria-label="`${group.tileset.name} / tile ${tile - 1}`" @pointerdown="beginSelection($event, group.tileset, tile - 1)" @pointerenter="extendSelection(group.tileset, tile - 1)" @pointerup="endSelection" />
          </div>
        </div>
      </details>
    </div>
  </EditorPanel>
</template>
