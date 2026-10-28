<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ open: boolean }>();
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
  <dialog id="commandsDialog" ref="dialog" aria-labelledby="commandsTitle" @cancel="close" @close="emit('update:open', false)" @click.self="close">
    <div class="commands-header">
      <h2 id="commandsTitle">Commands</h2>
      <button class="action icon-action" type="button" aria-label="Close commands" title="Close commands" @click="close"><EditorIcon name="close" /></button>
    </div>
    <div class="commands-body">
      <div class="commands-column">
        <section>
          <h3>Navigation</h3>
          <div class="commands-list">
            <div><span>Paint with the active tool</span><span><span class="kbd">Drag</span></span></div>
            <div><span>Zoom the canvas</span><span><span class="kbd">Scroll</span></span></div>
            <div><span>Pan the canvas</span><span><span class="kbd">Alt</span> + <span class="kbd">LMB</span> or <span class="kbd">MMB</span></span></div>
          </div>
        </section>
        <section>
          <h3>Actions</h3>
          <div class="commands-list">
            <div><span>Paint or place the active tool</span><span><span class="kbd">LMB</span></span></div>
            <div><span>Erase at the current position</span><span><span class="kbd">RMB</span></span></div>
            <div><span>Select a tileset tile, then choose a metatile cell</span><span><span class="kbd">Metatile edit</span></span></div>
          </div>
        </section>
      </div>
      <section>
        <h3>Keyboard shortcuts</h3>
        <div class="commands-list">
          <div><span>Select an object</span><span><span class="kbd">S</span></span></div>
          <div><span>Tile tool</span><span><span class="kbd">T</span></span></div>
          <div><span>Object tool</span><span><span class="kbd">O</span></span></div>
          <div><span>Entity tool</span><span><span class="kbd">N</span></span></div>
          <div><span>Erase tool</span><span><span class="kbd">X</span></span></div>
          <div><span>Toggle grid</span><span><span class="kbd">G</span></span></div>
          <div><span>Undo</span><span><span class="kbd">Ctrl</span> + <span class="kbd">Z</span></span></div>
          <div><span>Redo</span><span><span class="kbd">Ctrl</span> + <span class="kbd">Y</span></span></div>
        </div>
      </section>
    </div>
  </dialog>
</template>
