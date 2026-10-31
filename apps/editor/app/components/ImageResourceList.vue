<script setup lang="ts">
withDefaults(defineProps<{
  items: any[];
  columns?: number;
  selectedId: string | null;
  ariaLabel: string;
}>(), { columns: 2 });

const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="image-resource-list" role="list" :aria-label="ariaLabel" :style="{ '--image-resource-columns': columns }">
    <div v-for="item in items" :key="item.id" class="image-resource-card" role="listitem">
      <button class="image-resource" :class="{ selected: item.id === selectedId }" type="button" @click="$emit('select', item.id)"><slot name="preview" :item="item" /></button>
      <div class="image-resource-name-row"><slot name="actions" :item="item" /></div>
    </div>
  </div>
</template>
