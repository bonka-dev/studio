<script setup lang="ts">
import { ref } from "vue";

type PanelTab = { id: string; label: string };

const props = withDefaults(defineProps<{
  title: string;
  collapsible?: boolean;
  headerless?: boolean;
  tabs?: PanelTab[];
  activeTab?: string;
}>(), { collapsible: true, headerless: false, tabs: () => [] });
const emit = defineEmits<{ "update:activeTab": [id: string] }>();

const collapsed = ref(false);
</script>

<template>
    <section class="panel" :class="{ collapsed, static: !collapsible, headerless, 'has-title-actions': Boolean($slots.actions) || props.tabs.length }">
    <div v-if="!headerless && props.tabs.length" class="panel-tab-header" @click="collapsible && (collapsed = !collapsed)">
      <div class="panel-tabs" role="tablist" :aria-label="`${title} views`">
        <button v-for="tab in props.tabs" :key="tab.id" class="action" :class="{ primary: tab.id === activeTab }" type="button" role="tab" :aria-selected="tab.id === activeTab" @click.stop="$emit('update:activeTab', tab.id)">{{ tab.label }}</button>
      </div>
    </div>
    <button v-else-if="!headerless" class="panel-title" type="button" :aria-expanded="collapsible ? String(!collapsed) : undefined" :title="collapsible ? (collapsed ? 'Expand panel' : 'Collapse panel') : undefined" @click="collapsible && (collapsed = !collapsed)"><span>{{ title }}</span></button>
    <div v-if="!headerless && !props.tabs.length && $slots.actions" class="panel-title-actions">
      <slot name="actions" />
    </div>
    <div class="panel-content">
      <slot />
    </div>
  </section>
</template>
