<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ open: boolean; id: string; title: string; dialogClass?: string }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();
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

onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog :id="id" ref="dialog" class="modal-dialog" :class="dialogClass" :aria-labelledby="`${id}-title`" @cancel="close" @close="$emit('update:open', false)" @click.self="close">
    <div class="modal-header">
      <h2 :id="`${id}-title`">{{ title }}</h2>
      <slot name="actions" :close="close" />
    </div>
    <div class="modal-body"><slot :close="close" /></div>
  </dialog>
</template>
