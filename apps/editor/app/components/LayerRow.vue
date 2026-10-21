<script setup lang="ts">
import { computed, ref } from "vue";

defineOptions({ name: "LayerRow" });

const props = defineProps<{
  layer: any;
  depth: number;
  activeLayerId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  "toggle-visibility": [id: string];
  move: [movingId: string, targetId: string];
}>();

const dropTarget = ref(false);

function startDrag(event: DragEvent) {
  if(!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", props.layer.id);
}

function dragOver(event: DragEvent) {
  event.preventDefault();
  if(event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dropTarget.value = true;
}

function drop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dropTarget.value = false;
  const movingId = event.dataTransfer?.getData("text/plain");
  if(movingId && movingId !== props.layer.id) emit("move", movingId, props.layer.id);
}

const kind = computed(() => props.layer.type === "group" ? "Group" : props.layer.type === "object" ? "Object" : "Tile");
const metadata = computed(() => {
  if(props.layer.type === "group") {
    const count = props.layer.layers.length;
    return `${kind.value} - ${count} layer${count === 1 ? "" : "s"}`;
  }
  const placements = props.layer.placements.length;
  const objects = props.layer.objects.length;
  return `${kind.value} - ${placements} tile${placements === 1 ? "" : "s"} - ${objects} object${objects === 1 ? "" : "s"}`;
});
</script>

<template>
  <div class="layer-row" :class="{ active: layer.id === activeLayerId, 'group-row': layer.type === 'group', 'drop-target': dropTarget }" :style="{ '--layer-depth': depth }" draggable="true" @dragstart="startDrag" @dragover="dragOver" @dragleave="dropTarget = false" @dragend="dropTarget = false" @drop="drop">
    <button class="visibility-button layer-icon" type="button" :title="layer.visible === false ? 'Show layer' : 'Hide layer'" :aria-label="layer.visible === false ? 'Show layer' : 'Hide layer'" @click.stop="$emit('toggle-visibility', layer.id)">
      <svg v-if="layer.visible === false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 3 18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.5 6.5C3.5 8.4 2 12 2 12s3.5 6 10 6a10 10 0 0 0 3.5-.6" /></svg>
      <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>
    </button>
    <span class="layer-type-icon" :title="`${kind} layer`">
      <svg v-if="layer.type === 'group'" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5z" /></svg>
      <svg v-else-if="layer.type === 'object'" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.752.066a.5.5 0 0 1 .496 0l3.75 2.143a.5.5 0 0 1 .252.434v3.995l3.498 2A.5.5 0 0 1 16 9.07v4.286a.5.5 0 0 1-.252.434l-3.75 2.143a.5.5 0 0 1-.496 0l-3.502-2-3.502 2.001a.5.5 0 0 1-.496 0l-3.75-2.143A.5.5 0 0 1 0 13.357V9.071a.5.5 0 0 1 .252-.434L3.75 6.638V2.643a.5.5 0 0 1 .252-.434zM4.25 7.504 1.508 9.071l2.742 1.567 2.742-1.567zM7.5 9.933l-2.75 1.571v3.134l2.75-1.571zm1 3.134 2.75 1.571v-3.134L8.5 9.933zm.508-3.996 2.742 1.567 2.742-1.567-2.742-1.567zm2.242-2.433V3.504L8.5 5.076V8.21zM7.5 8.21V5.076L4.75 3.504v3.134zM5.258 2.643 8 4.21l2.742-1.567L8 1.076zM15 9.933l-2.75 1.571v3.134L15 13.067zM3.75 14.638v-3.134L1 9.933v3.134z" /></svg>
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h13A1.5 1.5 0 0 1 16 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5zM1.5 1a.5.5 0 0 0-.5.5V5h4V1zM5 6H1v4h4zm1 4h4V6H6zm-1 1H1v3.5a.5.5 0 0 0 .5.5H5zm1 0v4h4v-4zm5 0v4h3.5a.5.5 0 0 0 .5-.5V11zm0-1h4V6h-4zm0-5h4V1.5a.5.5 0 0 0-.5-.5H11zm-1 0V1H6v4z" /></svg>
    </span>
    <button class="layer-select" type="button" @click="$emit('select', layer.id)">
      <strong>{{ layer.name }}</strong>
      <span>{{ metadata }}</span>
    </button>
  </div>
  <template v-if="layer.type === 'group'">
    <LayerRow v-for="child in [...layer.layers].reverse()" :key="child.id" :layer="child" :depth="depth + 1" :active-layer-id="activeLayerId" @select="$emit('select', $event)" @toggle-visibility="$emit('toggle-visibility', $event)" @move="(movingId, targetId) => $emit('move', movingId, targetId)" />
  </template>
</template>
