<script setup lang="ts">
defineProps<{ message: string; zoom: number; maxZoom?: number }>();

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
      <button class="action icon-action status-action" type="button" aria-label="Zoom out" title="Zoom out" @click="$emit('zoom-out')"><EditorIcon name="zoom-out" /></button>
      <label class="visually-hidden" for="zoom-range">Canvas zoom</label>
      <input id="zoom-range" class="zoom-slider" type="range" min="25" :max="(maxZoom ?? 4) * 100" step="25" :value="Math.round(zoom * 100)" :title="`Zoom: ${Math.round(zoom * 100)}%`" @input="setZoom">
      <button class="action icon-action status-action" type="button" aria-label="Zoom in" title="Zoom in" @click="$emit('zoom-in')"><EditorIcon name="zoom-in" /></button>
      <button class="action icon-action status-action" type="button" aria-label="Reset zoom to 100%" title="Reset to 100%" @click="$emit('reset-view')"><EditorIcon name="reset" /></button>
      <button class="action icon-action status-action" type="button" aria-label="Fit map to viewport" title="Fit to viewport" @click="$emit('fit-view')"><EditorIcon name="fit" /></button>
    </div>
    <p class="status" role="status" aria-live="polite" :title="message">{{ message }}</p>
  </footer>
</template>
