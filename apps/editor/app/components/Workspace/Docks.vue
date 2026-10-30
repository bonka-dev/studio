<script setup lang="ts">
import type { DockZone } from "../../composables/use-workspace-dock-layout";

type PanelDefinition = { id: string; label: string; class?: string };

const props = defineProps<{ panels: PanelDefinition[]; layout: any; leftLabel: string; rightLabel: string }>();
const zones: DockZone[] = ["left", "right"];

function definition(id: string) {
  return props.panels.find(panel => panel.id === id) ?? { id, label: id };
}

function label(zone: DockZone) {
  return zone === "left" ? props.leftLabel : props.rightLabel;
}
</script>

<template>
  <aside v-for="zone in zones" :key="zone" class="workspace-stack workspace-dock" :class="[`workspace-region--${zone}`, { 'is-empty-dock': !layout.zones[zone].length, 'is-empty-insert-target': layout.isEmptyInsertionTarget(zone) }]" :aria-label="label(zone)" @dragover="layout.previewDrop(zone, $event)" @drop="layout.dropAt(zone, $event)">
    <div v-for="panel in layout.zones[zone]" :key="panel.key" v-bind="layout.dragItem(zone, panel.key)" class="panel-stack-item" :class="{ 'is-dragging': layout.dragged?.zone === zone && layout.dragged.panelKey === panel.key && !layout.dragged.tab, 'is-dock-target': layout.dockTarget?.zone === zone && layout.dockTarget.key === panel.key, 'is-insert-after': layout.isInsertionAfter(zone, panel.key) }">
      <EditorPanel :title="panel.tabs.length === 1 ? definition(panel.tabs[0]).label : 'Panels'" :class="definition(layout.activeTab(panel)).class" :tabs="panel.tabs.length > 1 ? panel.tabs.map((tab: string) => ({ id: tab, label: definition(tab).label })) : []" :active-tab="layout.activeTab(panel)" :draggable-tabs="panel.tabs.length > 1" dockable @update:active-tab="layout.setActiveTab(panel, $event)" @tab-drag-start="(tab, event) => layout.startTabDrag(zone, tab, event)" @tab-drag-end="layout.clearDrag" @tab-drag-over="layout.previewMerge(zone, panel.key, $event)" @tab-drop="layout.mergeInto(zone, panel.key, $event)">
        <slot :name="layout.activeTab(panel)" />
      </EditorPanel>
    </div>
  </aside>
</template>
