<script setup lang="ts">
defineProps<{ showGrid: boolean; showFootprints: boolean; flipX: boolean; flipY: boolean; brushSpacing: number; canClear: boolean }>();
defineEmits<{ "update:showGrid": [value: boolean]; "update:showFootprints": [value: boolean]; "update:flipX": [value: boolean]; "update:flipY": [value: boolean]; "update:brushSpacing": [value: number]; clear: [] }>();
</script>

<template>
  <EditorPanel title="View">
    <div class="compact-content">
      <label class="toggle"><span>Grid</span><input type="checkbox" :checked="showGrid" @change="$emit('update:showGrid', ($event.target as HTMLInputElement).checked)"></label>
      <label class="toggle"><span>Metatile footprint</span><input type="checkbox" :checked="showFootprints" @change="$emit('update:showFootprints', ($event.target as HTMLInputElement).checked)"></label>
      <label class="toggle"><span>Flip tile X</span><input type="checkbox" :checked="flipX" @change="$emit('update:flipX', ($event.target as HTMLInputElement).checked)"></label>
      <label class="toggle"><span>Flip tile Y</span><input type="checkbox" :checked="flipY" @change="$emit('update:flipY', ($event.target as HTMLInputElement).checked)"></label>
      <label class="field"><span>Brush spacing</span><PillEditor :model-value="brushSpacing" type="number" aria-label="Brush spacing" @change="$emit('update:brushSpacing', Math.min(8, Math.max(1, Number($event))))" /></label>
      <button class="action danger" type="button" :disabled="!canClear" @click="$emit('clear')">Clear active layer</button>
    </div>
  </EditorPanel>
</template>
