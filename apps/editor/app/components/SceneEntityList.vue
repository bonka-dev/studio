<script setup lang="ts">
defineProps<{
  entities: any[];
  definitions: any[];
  selectedId?: string | null;
}>();

defineEmits<{
  select: [id: string];
  edit: [definitionId: string];
}>();
</script>

<template>
  <section class="scene-entities" aria-labelledby="scene-entities-title">
    <div class="scene-entities-heading"><h3 id="scene-entities-title">Scene entities</h3><span>{{ entities.length }}</span></div>
    <div class="scene-entity-list" role="listbox" aria-label="Scene entity instances">
      <div v-for="entity in entities" :key="entity.id" class="scene-entity-row" :class="{ active: entity.id === selectedId }">
        <button class="scene-entity-select" type="button" role="option" :aria-selected="entity.id === selectedId" @click="$emit('select', entity.id)">
          <strong>{{ entity.id }}</strong>
          <span>{{ definitions.find(definition => definition.id === entity.definition)?.name ?? entity.definition }} at {{ entity.x }}, {{ entity.y }}</span>
        </button>
        <button class="action scene-entity-edit" type="button" :title="`Edit ${entity.definition} definition`" @click="$emit('edit', entity.definition)">Edit definition</button>
      </div>
      <p v-if="!entities.length" class="empty-note">No entity instances in this scene.</p>
    </div>
  </section>
</template>
