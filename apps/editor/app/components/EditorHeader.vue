<script setup lang="ts">
defineProps<{
  projectName: string;
  dirty: boolean;
  busy: boolean;
  saving: boolean;
  showSaved: boolean;
}>();

defineEmits<{
  save: [];
  close: [];
  commands: [];
}>();
</script>

<template>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand-mark" aria-hidden="true">B</span>
      <h1>{{ projectName || "Untitled Project" }} <span v-if="dirty && !saving" class="dirty-marker" title="Unsaved changes" aria-label="Unsaved changes">*</span></h1>
      <span v-if="saving" class="header-saving-badge">saving...</span>
      <span v-else-if="showSaved" class="header-saved-badge">saved</span>
    </div>
    <div class="header-actions">
      <button class="action primary" type="button" :disabled="!dirty || busy" @click="$emit('save')">Save project</button>
      <button class="action" type="button" :disabled="busy" @click="$emit('close')">Close</button>
      <button class="action header-help" type="button" aria-label="Open commands" title="Commands" @click="$emit('commands')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
          <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
        </svg>
      </button>
    </div>
  </header>
</template>
