<script setup lang="ts">
defineProps<{
  projectName: string;
  dirty: boolean;
  busy: boolean;
  saving: boolean;
  showSaved: boolean;
  workspaceMode: "map" | "entities" | "tiles" | "sprite" | "sprites";
}>();
defineEmits<{ save: []; close: []; commands: []; "update:workspaceMode": [mode: "map" | "entities" | "tiles" | "sprite" | "sprites"] }>();
</script>

<template>
  <main class="editor-shell">
    <EditorHeader :project-name="projectName" :dirty="dirty" :busy="busy" :saving="saving" :show-saved="showSaved" :workspace-mode="workspaceMode" @update:workspace-mode="$emit('update:workspaceMode', $event)" @save="$emit('save')" @close="$emit('close')" @commands="$emit('commands')" />
    <div class="workspace-host"><slot name="workspace" /></div>
    <slot name="status" />
    <slot name="overlays" />
  </main>
</template>
