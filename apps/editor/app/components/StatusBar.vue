<script setup lang="ts">
defineProps<{ message: string; zoom: number }>();

const emit = defineEmits<{
  "zoom-out": [];
  "set-zoom": [zoom: number];
  "zoom-in": [];
  "reset-view": [];
  "fit-view": [];
}>();

function setZoom(event: Event) {
  emit("set-zoom", Number((event.target as HTMLInputElement).value) / 100);
}
</script>

<template>
  <footer class="status-bar">
    <div class="cursor-status"><span>Cell --, --</span><span>Pixel --, --</span></div>
    <div class="status-controls" aria-label="Canvas zoom controls">
      <button class="action icon-action status-action" type="button" aria-label="Zoom out" title="Zoom out" @click="$emit('zoom-out')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
      <label class="visually-hidden" for="zoom-range">Canvas zoom</label>
      <input id="zoom-range" class="zoom-slider" type="range" min="25" max="400" step="25" :value="Math.round(zoom * 100)" :title="`Zoom: ${Math.round(zoom * 100)}%`" @input="setZoom">
      <button class="action icon-action status-action" type="button" aria-label="Zoom in" title="Zoom in" @click="$emit('zoom-in')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
      <button class="action icon-action status-action" type="button" aria-label="Reset zoom to 100%" title="Reset to 100%" @click="$emit('reset-view')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" /></svg></button>
      <button class="action icon-action status-action" type="button" aria-label="Fit map to viewport" title="Fit to viewport" @click="$emit('fit-view')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg></button>
    </div>
    <p class="status" role="status" aria-live="polite">{{ message }}</p>
  </footer>
</template>
