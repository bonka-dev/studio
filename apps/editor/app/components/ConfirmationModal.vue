<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}>();
const emit = defineEmits<{ "update:open": [open: boolean]; confirm: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);

watch(() => props.open, async open => {
  await nextTick();
  if(!dialog.value) return;
  if(open && !dialog.value.open) dialog.value.showModal();
  if(!open && dialog.value.open) dialog.value.close();
}, { flush: "post", immediate: true });

function close() {
  emit("update:open", false);
}

function confirm() {
  emit("confirm");
  close();
}

onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog id="confirmationDialog" ref="dialog" aria-labelledby="confirmationTitle" @cancel="close" @close="$emit('update:open', false)" @click.self="close">
    <div class="confirmation-header">
      <h2 id="confirmationTitle">{{ title }}</h2>
    </div>
    <div class="confirmation-body">
      <p>{{ message }}</p>
      <div class="confirmation-actions">
        <button class="action" type="button" @click="close">Cancel</button>
        <button class="action" :class="{ danger }" type="button" @click="confirm">{{ confirmLabel ?? "Continue" }}</button>
      </div>
    </div>
  </dialog>
</template>
