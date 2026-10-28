<script setup lang="ts">
defineProps<{ entries: Array<{ revision: number; label: string }>; currentIndex: number }>();
defineEmits<{ "go-to": [index: number] }>();
</script>

<template>
  <EditorPanel title="History" class="history-panel">
    <div class="history-list" role="list" aria-label="Edit history">
      <p v-if="!entries.length" class="empty-note">History starts when canvas editing is available.</p>
      <button v-for="(entry, index) in [...entries].reverse()" :key="entry.revision" class="history-row" :class="{ current: entries.length - index - 1 === currentIndex, future: entries.length - index - 1 > currentIndex }" type="button" @click="$emit('go-to', entries.length - index - 1)">{{ entry.label }}</button>
    </div>
  </EditorPanel>
</template>
