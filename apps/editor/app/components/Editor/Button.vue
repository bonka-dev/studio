<script setup lang="ts">
withDefaults(defineProps<{ tone?: "normal" | "primary" | "danger"; active?: boolean; activeTone?: "cyan" | "gold" }>(), { tone: "normal", active: false, activeTone: "cyan" });
</script>

<template>
  <button class="action" :class="[tone === 'normal' ? null : tone, { active, [`active-${activeTone}`]: active }]" type="button"><slot /></button>
</template>
