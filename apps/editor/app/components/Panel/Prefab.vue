<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  prefabs: any[];
  metatiles: any[];
  tilesets: any[];
  selectedPrefabId: string | null;
  selectedMetatileId: string | null;
  editable?: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  add: [options: { name: string; columns: number; rows: number }];
  select: [id: string];
  "activate-cell": [options: { index: number; clear: boolean }];
}>();

const name = ref("Prefab");
const columns = ref(1);
const rows = ref(1);
const selected = computed(() => props.prefabs.find(prefab => prefab.id === props.selectedPrefabId) ?? null);
function placementAt(index: number) {
  if(!selected.value) return null;
  const x = index % selected.value.columns;
  const y = Math.floor(index / selected.value.columns);
  return selected.value.placements.find((placement: any) => placement.cell.x === x && placement.cell.y === y) ?? null;
}
function metatile(id: string) {
  return props.metatiles.find(item => item.id === id) ?? null;
}
</script>

<template>
  <template v-if="editable">
    <label class="field field-stack" for="prefab-name"><span>Name</span><PillEditor id="prefab-name" :model-value="name" aria-label="Prefab name" @change="name = String($event)" /></label>
    <div class="field-pair">
      <label class="field field-stack" for="prefab-columns"><span>Columns</span><PillEditor id="prefab-columns" :model-value="columns" type="number" aria-label="Prefab columns" @change="columns = Math.max(1, Number($event))" /></label>
      <label class="field field-stack" for="prefab-rows"><span>Rows</span><PillEditor id="prefab-rows" :model-value="rows" type="number" aria-label="Prefab rows" @change="rows = Math.max(1, Number($event))" /></label>
    </div>
    <button class="action primary" type="button" :disabled="busy" @click="$emit('add', { name: name.trim() || 'Prefab', columns, rows })">Add prefab</button>
    <div v-if="selected" class="metatile-editor prefab-editor" role="grid" aria-label="Prefab cell editor" :style="{ gridTemplateColumns: `repeat(${selected.columns}, minmax(42px, 1fr))` }">
      <button v-for="(_, index) in selected.columns * selected.rows" :key="index" class="metatile-cell" type="button" :aria-label="`Prefab cell ${index}`" @click="$emit('activate-cell', { index, clear: false })" @contextmenu.prevent="$emit('activate-cell', { index, clear: true })">
        <MetatilePreview v-if="placementAt(index) && metatile(placementAt(index).metatile)" :metatile="metatile(placementAt(index).metatile)" :tilesets="tilesets" />
      </button>
    </div>
    <p v-else class="empty-note">Select or add a prefab to compose it.</p>
  </template>
  <div class="resource-list" role="list" aria-label="Prefabs">
    <button v-for="prefab in prefabs" :key="prefab.id" class="resource-button" :class="{ selected: prefab.id === selectedPrefabId }" type="button" @click="$emit('select', prefab.id)">
      <span>{{ prefab.name }}</span><small>{{ prefab.columns }}x{{ prefab.rows }}</small>
    </button>
    <p v-if="!prefabs.length" class="empty-note">No prefabs yet.</p>
  </div>
</template>
