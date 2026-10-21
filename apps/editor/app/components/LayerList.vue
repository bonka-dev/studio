<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  layers: any[];
  activeLayerId: string | null;
}>();

defineEmits<{
  select: [id: string];
  "toggle-visibility": [id: string];
  move: [movingId: string, targetId: string];
}>();

const reversedLayers = computed(() => [...props.layers].reverse());
</script>

<template>
  <div class="layer-list" role="listbox" aria-label="Scene layers">
    <p v-if="!layers.length" class="empty-note">Add a layer to start painting the scene.</p>
    <LayerRow v-for="layer in reversedLayers" :key="layer.id" :layer="layer" :depth="0" :active-layer-id="activeLayerId" @select="$emit('select', $event)" @toggle-visibility="$emit('toggle-visibility', $event)" @move="(movingId, targetId) => $emit('move', movingId, targetId)" />
  </div>
</template>
