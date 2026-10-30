<script setup lang="ts">
import { ref } from "vue";

defineProps<{ tilesets: any[]; selectedId: string | null; busy: boolean }>();
const emit = defineEmits<{ import: [files: File[]]; select: [id: string]; rename: [id: string, name: string]; remove: [id: string] }>();
const tilesetInput = ref<HTMLInputElement | null>(null);

function importTilesets(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if(files.length) emit("import", files);
}
</script>

<template>
  <button class="action" type="button" :disabled="busy" @click="tilesetInput?.click()">Import PNG</button>
  <input ref="tilesetInput" type="file" accept="image/png,.png" multiple hidden @change="importTilesets">
  <div class="tileset-resource-list">
    <div v-for="tileset in tilesets" :key="tileset.id" class="tileset-resource-card">
      <button class="tileset-resource" :class="{ active: tileset.id === selectedId }" type="button" @click="$emit('select', tileset.id)"><img :src="tileset.image" :alt="`${tileset.name} preview`"></button>
      <div class="tileset-resource-name-row">
        <PillEditor :model-value="tileset.name" :aria-label="`${tileset.id} tileset name`" @change="$emit('rename', tileset.id, String($event).trim() || tileset.name)" />
        <EditorButton tone="danger" class="icon-action tileset-resource-delete" aria-label="Delete tileset" :title="`Delete ${tileset.id}`" :disabled="busy" @click="$emit('remove', tileset.id)"><EditorIcon name="trash" /></EditorButton>
      </div>
    </div>
  </div>
</template>
