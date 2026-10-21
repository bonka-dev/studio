<script setup lang="ts">
defineProps<{ selection?: any | null }>();
defineEmits<{ patch: [patch: Record<string, unknown>]; remove: [] }>();
</script>

<template>
  <EditorPanel title="Selection">
    <div class="inspector">
      <div class="context-row"><span>Type</span><strong>{{ selection?.kind ?? "None" }}</strong></div>
      <label class="field"><span>ID</span><PillEditor :model-value="selection?.id ?? ''" aria-label="Selection ID" disabled /></label>
      <label class="field"><span>Name</span><PillEditor :model-value="selection?.name ?? ''" aria-label="Selection name" :disabled="!selection" @change="$emit('patch', { name: String($event) })" /></label>
      <label class="toggle"><span>Visible</span><input type="checkbox" :checked="selection?.visible ?? false" :disabled="!selection" @change="$emit('patch', { visible: ($event.target as HTMLInputElement).checked })"></label>
      <div class="field-pair"><label class="field field-stack"><span>X</span><PillEditor :model-value="selection?.x ?? ''" type="number" aria-label="Selection X coordinate" :disabled="!selection" @change="$emit('patch', { x: Number($event) })" /></label><label class="field field-stack"><span>Y</span><PillEditor :model-value="selection?.y ?? ''" type="number" aria-label="Selection Y coordinate" :disabled="!selection" @change="$emit('patch', { y: Number($event) })" /></label></div>
      <button class="action danger" type="button" :disabled="!selection" @click="$emit('remove')">Delete selection</button>
    </div>
  </EditorPanel>
</template>
