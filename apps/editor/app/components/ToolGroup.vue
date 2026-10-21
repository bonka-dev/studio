<script setup lang="ts">
const tools = [
  { id: "select", label: "Select", shortcut: "S" },
  { id: "tile", label: "Tile", shortcut: "T" },
  { id: "object", label: "Object", shortcut: "O" },
  { id: "entity", label: "Entity", shortcut: "N" },
  { id: "player", label: "Player", shortcut: "P" },
  { id: "enemy", label: "Enemy", shortcut: "E" },
  { id: "erase", label: "Erase", shortcut: "X" },
];

defineProps<{ modelValue: string }>();

defineEmits<{
  "update:modelValue": [tool: string];
}>();
</script>

<template>
  <div class="tool-group" role="toolbar" aria-label="Canvas tools">
    <button v-for="tool in tools" :key="tool.id" class="tool" :class="{ active: modelValue === tool.id }" type="button" :data-tool="tool.id" :aria-pressed="modelValue === tool.id" :title="`Keyboard shortcut: ${tool.shortcut}`" @click="$emit('update:modelValue', tool.id)">
      {{ tool.label }} <span class="kbd">{{ tool.shortcut }}</span>
    </button>
  </div>
</template>
