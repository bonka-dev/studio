<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  tileset: any | null;
  selection: { tileset: string; startTile: number; columns: number; rows: number } | null;
  maxColumns: number;
  maxRows: number;
}>();
const emit = defineEmits<{
  select: [selection: { tileset: string; startTile: number; columns: number; rows: number }];
}>();

const dragStart = ref<number | null>(null);

function selectionFor(first: number, last: number) {
  const tileset = props.tileset;
  if(!tileset) return null;
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

function beginSelection(tile: number) {
  dragStart.value = tile;
  const selection = selectionFor(tile, tile);
  if(selection) emit("select", selection);
}

function extendSelection(tile: number) {
  if(dragStart.value === null) return;
  const selection = selectionFor(dragStart.value, tile);
  if(selection) emit("select", selection);
}
</script>

<template>
  <div v-if="tileset" class="tile-palette" role="listbox" :aria-label="`${tileset.name} tile palette`" tabindex="0">
    <div class="tileset-image-picker" :style="{ '--tileset-columns': String(tileset.columns), '--tileset-rows': String(Math.ceil(tileset.tileCount / tileset.columns)) }">
      <img :src="tileset.image" :alt="`${tileset.name} tileset`">
      <div class="tileset-hit-grid" role="grid" :aria-label="`${tileset.name} tile selection`">
        <button v-for="tile in tileset.tileCount" :key="tile - 1" class="tileset-hitbox" :class="{ selected: selection?.tileset === tileset.id && tile - 1 >= selection.startTile && tile - 1 < selection.startTile + selection.rows * tileset.columns && (tile - 1) % tileset.columns >= selection.startTile % tileset.columns && (tile - 1) % tileset.columns < selection.startTile % tileset.columns + selection.columns }" type="button" :aria-label="`${tileset.name} / tile ${tile - 1}`" @pointerdown="beginSelection(tile - 1)" @pointerenter="extendSelection(tile - 1)" @pointerup="dragStart = null" />
      </div>
    </div>
  </div>
  <p v-else class="empty-note">Select a tileset to choose 8x8 tiles.</p>
</template>
