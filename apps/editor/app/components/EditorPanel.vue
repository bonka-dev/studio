<script setup lang="ts">
import { ref } from "vue";

type PanelTab = { id: string; label: string };

const props = withDefaults(defineProps<{
  title: string;
  collapsible?: boolean;
  headerless?: boolean;
  tabs?: PanelTab[];
  activeTab?: string;
  draggableTabs?: boolean;
  dockable?: boolean;
}>(), { collapsible: true, headerless: false, tabs: () => [], draggableTabs: false, dockable: false });
const emit = defineEmits<{ "update:activeTab": [id: string]; "tab-drag-start": [id: string, event: DragEvent]; "tab-drag-end": []; "tab-drag-over": [event: DragEvent]; "tab-drop": [event: DragEvent] }>();

const collapsed = ref(false);

function dragOver(event: DragEvent) {
  if(!props.dockable) return;
  event.preventDefault();
  event.stopPropagation();
  emit("tab-drag-over", event);
}

function drop(event: DragEvent) {
  if(!props.dockable) return;
  event.preventDefault();
  event.stopPropagation();
  emit("tab-drop", event);
}
</script>

<template>
    <section class="panel" :class="{ collapsed, static: !collapsible, headerless, 'has-title-actions': Boolean($slots.actions) || props.tabs.length }">
    <div v-if="!headerless && props.tabs.length" class="panel-tab-header" @click="collapsible && (collapsed = !collapsed)" @dragover="dragOver" @drop="drop">
      <div class="panel-tabs" role="tablist" :aria-label="`${title} views`">
        <button v-for="tab in props.tabs" :key="tab.id" class="action" :class="{ primary: tab.id === activeTab }" type="button" role="tab" :aria-selected="tab.id === activeTab" :draggable="draggableTabs" @click.stop="$emit('update:activeTab', tab.id)" @dragstart.stop="$emit('tab-drag-start', tab.id, $event)" @dragend.stop="$emit('tab-drag-end')">{{ tab.label }}</button>
      </div>
    </div>
    <button v-else-if="!headerless" class="panel-title" type="button" :aria-expanded="collapsible ? String(!collapsed) : undefined" :title="collapsible ? (collapsed ? 'Expand panel' : 'Collapse panel') : undefined" @click="collapsible && (collapsed = !collapsed)" @dragover="dragOver" @drop="drop"><span>{{ title }}</span></button>
    <div v-if="!headerless && !props.tabs.length && $slots.actions" class="panel-title-actions">
      <slot name="actions" />
    </div>
    <div class="panel-content">
      <slot />
    </div>
  </section>
</template>
