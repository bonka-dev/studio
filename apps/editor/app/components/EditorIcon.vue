<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ name: string }>();

const filledIcons = new Set(["trash", "play", "pause", "tile-layer", "object-layer", "layer-group"]);
const compactIcons = new Set(["trash", "tile-layer", "object-layer", "layer-group"]);
const isFilled = computed(() => filledIcons.has(props.name));
const isRounded = computed(() => props.name === "skip-start" || props.name === "skip-end");
const viewBox = computed(() => compactIcons.has(props.name) ? "0 0 16 16" : "0 0 24 24");
</script>

<template>
  <svg class="editor-icon" :class="{ 'editor-icon--fill': isFilled, 'editor-icon--stroke': !isFilled, 'editor-icon--rounded': isRounded }" :viewBox="viewBox" aria-hidden="true">
    <template v-if="name === 'undo'"><path d="m9 14-5-5 5-5" /><path d="M4 9h10a6 6 0 1 1 0 12h-3" /></template>
    <template v-else-if="name === 'redo'"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 1 0 0 12h3" /></template>
    <template v-else-if="name === 'trash'"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" /><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" /></template>
    <template v-else-if="name === 'close'"><path d="m6 6 12 12M18 6 6 18" /></template>
    <template v-else-if="name === 'previous'"><path d="m15 18-6-6 6-6" /></template>
    <template v-else-if="name === 'next'"><path d="m9 18 6-6-6-6" /></template>
    <template v-else-if="name === 'skip-start'"><polygon points="19 20 9 12 19 4 19 20" /><path d="M5 19V5" /></template>
    <template v-else-if="name === 'skip-end'"><polygon points="5 4 15 12 5 20 5 4" /><path d="M19 5v14" /></template>
    <template v-else-if="name === 'zoom-out'"><path d="M5 12h14" /></template>
    <template v-else-if="name === 'zoom-in'"><path d="M5 12h14M12 5v14" /></template>
    <template v-else-if="name === 'fit'"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></template>
    <template v-else-if="name === 'reset'"><path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3" /></template>
    <template v-else-if="name === 'play'"><path d="m8 5 11 7-11 7z" /></template>
    <template v-else-if="name === 'pause'"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></template>
    <template v-else-if="name === 'eye'"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 18 2 12Z" /><circle cx="12" cy="12" r="2.5" /></template>
    <template v-else-if="name === 'eye-off'"><path d="m3 3 18 18M10.6 6.2A11 11.2 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.5 6.5C3.5 8.4 2 12 2 12s3.5 6 10 6a10 10 0 0 0 3.5-.6" /></template>
    <template v-else-if="name === 'tile-layer'"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h13A1.5 1.5 0 0 1 16 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5zM1.5 1a.5.5 0 0 0-.5.5V5h4V1zM5 6H1v4h4zm1 4h4V6H6zm-1 1H1v3.5a.5.5 0 0 0 .5.5H5zm1 0v4h4v-4zm5 0v4h3.5a.5.5 0 0 0 .5-.5V11zm0-1h4V6h-4zm0-5h4V1.5a.5.5 0 0 0-.5-.5H11zm-1 0V1H6v4z" /></template>
    <template v-else-if="name === 'object-layer'"><path d="M7.752.066a.5.5 0 0 1 .496 0l3.75 2.143a.5.5 0 0 1 .252.434v3.995l3.498 2A.5.5 0 0 1 16 9.07v4.286a.5.5 0 0 1-.252.434l-3.75 2.143a.5.5 0 0 1-.496 0l-3.502-2-3.502 2.001a.5.5 0 0 1-.496 0l-3.75-2.143A.5.5 0 0 1 0 13.357V9.071a.5.5 0 0 1 .252-.434L3.75 6.638V2.643a.5.5 0 0 1 .252-.434zM4.25 7.504 1.508 9.071l2.742 1.567 2.742-1.567zM7.5 9.933l-2.75 1.571v3.134l2.75-1.571zm1 3.134 2.75 1.571v-3.134L8.5 9.933zm.508-3.996 2.742 1.567 2.742-1.567-2.742-1.567zm2.242-2.433V3.504L8.5 5.076V8.21zM7.5 8.21V5.076L4.75 3.504v3.134zM5.258 2.643 8 4.21l2.742-1.567L8 1.076zM15 9.933l-2.75 1.571v3.134L15 13.067zM3.75 14.638v-3.134L1 9.933v3.134z" /></template>
    <template v-else-if="name === 'layer-group'"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5z" /></template>
    <template v-else-if="name === 'group'"><path d="M3 7h7l2 2h9v10H3z" /><path d="M3 7V5h7l2 2" /></template>
    <template v-else-if="name === 'object'"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></template>
    <template v-else-if="name === 'tile'"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></template>
    <template v-else-if="name === 'brush'"><path d="m14 4 6 6-9.5 9.5a4 4 0 0 1-5.7 0l-.3-.3a4 4 0 0 1 0-5.7Z" /></template>
    <template v-else-if="name === 'image'"><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="8" cy="9" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></template>
    <template v-else-if="name === 'pen'"><path d="m14 4 6 6L8 22l-5 1 1-5Z" /></template>
    <template v-else-if="name === 'eraser'"><path d="m19 20H8.5l-4.21-4.3a1 1 0 0 1 0-1.41l10-10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41L11.5 20" /></template>
    <template v-else-if="name === 'eyedropper'"><path d="m14 4 6 6-11 11H3v-6Z" /><path d="m11 7 6 6" /></template>
    <template v-else-if="name === 'select'"><path d="M7 4H4v3m0 4v2m7-9h2m-2 16h2m7-9v2m-3-9h3v3M7 20H4v-3m13 3h3v-3" /></template>
    <template v-else-if="name === 'repeat'"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></template>
    <circle v-else cx="12" cy="12" r="8" />
  </svg>
</template>
