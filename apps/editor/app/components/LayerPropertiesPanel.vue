<script setup lang="ts">
defineProps<{ layer: any | null }>();
defineEmits<{ patch: [patch: Record<string, unknown>] }>();
</script>

<template>
  <div class="inspector">
    <label class="field"><span>ID</span><PillEditor :model-value="layer?.id ?? ''" aria-label="Layer ID" disabled /></label>
    <label class="field"><span>Name</span><PillEditor :model-value="layer?.name ?? ''" aria-label="Layer name" :disabled="!layer" @change="$emit('patch', { name: String($event) })" /></label>
    <label class="toggle"><span>Visible</span><input type="checkbox" :checked="layer?.visible !== false" :disabled="!layer" @change="$emit('patch', { visible: ($event.target as HTMLInputElement).checked })"></label>
    <label class="field slider-field"><span>Opacity</span><span class="property-slider"><input type="range" min="0" max="1" step="0.05" :value="layer?.opacity ?? 1" :disabled="!layer" @change="$emit('patch', { opacity: Number(($event.target as HTMLInputElement).value) })"><output>{{ Math.round((layer?.opacity ?? 1) * 100) }}%</output></span></label>
    <label class="field"><span>H offset</span><PillEditor :model-value="layer?.hOffset ?? 0" type="number" aria-label="Horizontal offset" :disabled="!layer" @change="$emit('patch', { hOffset: Number($event) })" /></label>
    <label class="field"><span>Z offset</span><PillEditor :model-value="layer?.zOffset ?? 0" type="number" aria-label="Vertical offset" :disabled="!layer" @change="$emit('patch', { zOffset: Number($event) })" /></label>
  </div>
</template>
