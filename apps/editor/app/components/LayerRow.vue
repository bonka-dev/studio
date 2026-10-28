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
      <EditorIcon :name="layer.visible === false ? 'eye-off' : 'eye'" />
    </button>
    <span class="layer-type-icon" :title="`${kind} layer`">
      <EditorIcon :name="layer.type === 'group' ? 'group' : layer.type === 'object' ? 'object' : 'tile'" />
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
