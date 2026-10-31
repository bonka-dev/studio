<script setup lang="ts">
import { ref } from "vue";

defineProps<{ sprites: any[]; selectedId: string; sourceUrls: Map<string, string>; busy?: boolean }>();
const emit = defineEmits<{ import: [files: File[]]; create: []; remove: [id: string]; rename: [id: string, name: string]; select: [id: string] }>();
const spriteInput = ref<HTMLInputElement | null>(null);

function importSprites(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if(files.length) emit("import", files);
}
</script>

<template>
  <button class="action" type="button" :disabled="busy" @click="spriteInput?.click()">Import PNG</button>
    <input ref="spriteInput" type="file" accept="image/png,.png" multiple hidden @change="importSprites">
    <button class="action" type="button" :disabled="busy" @click="$emit('create')">New 16x16 sprite</button>
    <ImageResourceList :items="sprites" :selected-id="selectedId" :columns="2" aria-label="Sprites" @select="$emit('select', $event)">
      <template #preview="{ item: sprite }"><img v-if="sourceUrls.get(`sprite:${sprite.id}`)" :src="sourceUrls.get(`sprite:${sprite.id}`)" :alt="`${sprite.id} preview`"></template>
      <template #actions="{ item: sprite }">
          <PillEditor :model-value="sprite.name ?? sprite.id" :aria-label="`${sprite.id} sprite name`" @change="$emit('rename', sprite.id, String($event).trim() || sprite.id)" />
          <EditorButton tone="danger" class="icon-action sprite-resource-delete" aria-label="Delete sprite" :title="`Delete ${sprite.id}`" :disabled="busy" @click="$emit('remove', sprite.id)"><EditorIcon name="trash" /></EditorButton>
      </template>
    </ImageResourceList>
</template>
