<script setup lang="ts">
defineProps<{ panels: { id: string; label: string; class?: string }[]; layout: any; leftLabel: string; rightLabel: string }>();
</script>

<template>
  <WorkspaceDock zone="left" :label="leftLabel" :panels="panels" :layout="layout">
    <template v-for="panel in panels" :key="panel.id" #[panel.id]><slot :name="panel.id" /></template>
  </WorkspaceDock>
  <WorkspaceDock zone="right" :label="rightLabel" :panels="panels" :layout="layout">
    <template v-for="panel in panels" :key="panel.id" #[panel.id]><slot :name="panel.id" /></template>
  </WorkspaceDock>
</template>
