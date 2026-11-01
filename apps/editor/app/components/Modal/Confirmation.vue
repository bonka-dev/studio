<script setup lang="ts">
defineProps<{ open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();

function confirm(close: () => void) {
  emit("confirm");
  close();
}
</script>

<template>
  <ModalShell id="confirmationDialog" dialog-class="confirmation-modal" :title="title" :open="open" @update:open="$emit('update:open', $event)">
    <template #default="{ close }">
      <p>{{ message }}</p>
      <div class="confirmation-actions">
        <button class="action" type="button" @click="close">Cancel</button>
        <button class="action" :class="{ danger }" type="button" @click="confirm(close)">{{ confirmLabel ?? "Continue" }}</button>
      </div>
    </template>
  </ModalShell>
</template>
