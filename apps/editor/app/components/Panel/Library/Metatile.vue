<script setup lang="ts">
defineProps<{ metatiles: any[]; tilesets: any[]; selectedMetatileId: string | null; busy: boolean }>();
defineEmits<{ select: [id: string]; rename: [id: string, name: string]; remove: [id: string] }>();
</script>

<template>
  <ImageResourceList class="metatile-image-resource-list" :items="metatiles" :selected-id="selectedMetatileId" :columns="3" aria-label="Metatiles" @select="$emit('select', $event)">
    <template #preview="{ item: metatile }"><MetatilePreview :metatile="metatile" :tilesets="tilesets" /></template>
    <template #actions="{ item: metatile }">
        <PillEditor :model-value="metatile.name" :aria-label="`${metatile.id} metatile name`" @change="$emit('rename', metatile.id, String($event).trim() || metatile.name)" />
        <EditorButton tone="danger" class="icon-action metatile-resource-delete" aria-label="Delete metatile" :title="`Delete ${metatile.id}`" :disabled="busy" @click="$emit('remove', metatile.id)"><EditorIcon name="trash" /></EditorButton>
    </template>
  </ImageResourceList>
</template>
