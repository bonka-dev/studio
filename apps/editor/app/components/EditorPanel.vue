<script setup lang="ts">
import { ref } from "vue";

defineProps<{ title: string }>();

const collapsed = ref(false);
</script>

<template>
  <section class="panel" :class="{ collapsed }">
    <button class="panel-title" type="button" :aria-expanded="String(!collapsed)" :title="collapsed ? 'Expand panel' : 'Collapse panel'" @click="collapsed = !collapsed"><span>{{ title }}</span></button>
    <div class="panel-content">
      <slot />
    </div>
  </section>
</template>
