<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  metatiles: any[];
  tilesets: any[];
  selectedMetatileId: string | null;
  selectedTile: { tileset: string; tile: number } | null;
  mode: "tiles" | "collision";
  busy: boolean;
}>();

const emit = defineEmits<{
  add: [options: { name: string; columns: number; rows: number }];
  select: [id: string];
  "activate-cell": [options: { index: number; clear: boolean }];
  "update:mode": [mode: "tiles" | "collision"];
  error: [message: string];
}>();
const name = ref("Metatile");
const columns = ref(4);
const rows = ref(4);
const selected = computed(() => props.metatiles.find(item => item.id === props.selectedMetatileId) ?? null);

function tilesetById(id: string) {
  return props.tilesets.find(item => item.id === id);
}

function add() {
  emit("add", { name: name.value.trim() || "Metatile", columns: columns.value, rows: rows.value });
}
</script>

<template>
  <EditorPanel title="Metatiles" class="metatile-panel">
    <label class="field field-stack" for="metatile-name"><span>Name</span><PillEditor id="metatile-name" :model-value="name" aria-label="Metatile name" @change="name = String($event)" /></label>
    <div class="field-pair">
      <label class="field field-stack" for="metatile-columns"><span>Columns</span><PillEditor id="metatile-columns" :model-value="columns" type="number" aria-label="Metatile columns" @change="columns = Math.max(1, Number($event))" /></label>
      <label class="field field-stack" for="metatile-rows"><span>Rows</span><PillEditor id="metatile-rows" :model-value="rows" type="number" aria-label="Metatile rows" @change="rows = Math.max(1, Number($event))" /></label>
    </div>
    <div class="inline-actions">
      <button class="action" type="button" :aria-pressed="mode === 'collision'" @click="$emit('update:mode', mode === 'tiles' ? 'collision' : 'tiles')">{{ mode === "tiles" ? "Paint mode" : "Collision mode" }}</button>
      <button class="action primary" type="button" :disabled="busy" @click="add">Add metatile</button>
    </div>
    <div v-if="selected" class="metatile-editor" role="grid" aria-label="Metatile cell editor" :style="{ gridTemplateColumns: `repeat(${selected.columns}, minmax(30px, 1fr))` }">
      <button v-for="(tile, index) in selected.data" :key="index" class="metatile-cell" type="button" :aria-label="`Metatile cell ${index}`" :title="tile ? `${tile.tileset} / tile ${tile.tile}` : 'Empty cell'" @click="$emit('activate-cell', { index, clear: false })" @contextmenu.prevent="$emit('activate-cell', { index, clear: true })">
        <TilePreview v-if="tile && tilesetById(tile.tileset)" :tileset="tilesetById(tile.tileset)" :tile="tile.tile" @error="$emit('error', $event)" />
        <span v-if="selected.collisionMap[index] === 1" class="collision-overlay">C</span>
      </button>
    </div>
    <div v-else class="metatile-editor" role="grid" aria-label="Metatile cell editor"><p>Select or add a metatile to compose it.</p></div>
    <div class="resource-list" role="list" aria-label="Metatiles">
      <button v-for="metatile in metatiles" :key="metatile.id" class="resource-button" :class="{ selected: metatile.id === selectedMetatileId }" type="button" @click="$emit('select', metatile.id)">
        <MetatilePreview :metatile="metatile" :tilesets="tilesets" />
        <span>{{ metatile.name }}</span>
      </button>
    </div>
  </EditorPanel>
</template>
