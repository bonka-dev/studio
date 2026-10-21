<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { createSceneRenderer, flattenTileLayers, scenePixelSize } from "../lib/canvas/scene-renderer.mjs";
import { interpolateIsoBrushCells, nearestIsoBrushCell, snapBrushCell } from "../lib/canvas/iso-brush.mjs";

const props = defineProps<{
  state: any;
  showGrid: boolean;
  showFootprints: boolean;
  activeLayerId: string | null;
  selectedMetatileId: string | null;
  flipX: boolean;
  flipY: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeTool: string;
  selection: { kind: "object" | "entity"; id: string; layerId?: string } | null;
  brushSpacing: number;
}>();
const emit = defineEmits<{
  error: [message: string];
  "zoom-change": [zoom: number];
  paint: [placement: { x: number; y: number; clear: boolean; point: { x: number; y: number } }];
  undo: [];
  redo: [];
  action: [action: { tool: string; point: { x: number; y: number } }];
  "update:activeTool": [tool: string];
  "stroke-start": [erase: boolean];
  "stroke-end": [erase: boolean];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const wrap = ref<HTMLDivElement | null>(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const panning = ref(false);
let renderer: ReturnType<typeof createSceneRenderer> | null = null;
let resizeObserver: ResizeObserver | null = null;
let panPointerId: number | null = null;
let panStart: { x: number; y: number; panX: number; panY: number } | null = null;
let paintPointerId: number | null = null;
let lastPaintCell: string | null = null;
let brushAnchor: { x: number; y: number } | null = null;
let lastBrushCell: { x: number; y: number } | null = null;
let strokeErases = false;

const sceneSize = computed(() => props.state ? scenePixelSize(props.state) : { width: 512, height: 512 });
const stageStyle = computed(() => ({
  width: `${sceneSize.value.width}px`,
  height: `${sceneSize.value.height}px`,
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));
const canvasStyle = computed(() => ({ width: `${sceneSize.value.width}px`, height: `${sceneSize.value.height}px` }));

function clampZoom(value: number) {
  return Math.min(4, Math.max(.25, value));
}

function centerAt(nextZoom = zoom.value) {
  if(!wrap.value) return;
  pan.value = {
    x: (wrap.value.clientWidth - sceneSize.value.width * nextZoom) / 2,
    y: (wrap.value.clientHeight - sceneSize.value.height * nextZoom) / 2,
  };
}

function fitView() {
  if(!wrap.value || !sceneSize.value.width || !sceneSize.value.height) return;
  zoom.value = clampZoom(Math.min(wrap.value.clientWidth / sceneSize.value.width, wrap.value.clientHeight / sceneSize.value.height));
  centerAt();
}

function zoomAtPointer(event: WheelEvent) {
  if(!wrap.value) return;
  const rect = wrap.value.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const nextZoom = clampZoom(zoom.value * (event.deltaY < 0 ? 1.25 : .8));
  const world = { x: (point.x - pan.value.x) / zoom.value, y: (point.y - pan.value.y) / zoom.value };
  pan.value = { x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom };
  zoom.value = nextZoom;
}

function zoomAtCenter(nextZoom: number) {
  if(!wrap.value) return;
  const point = { x: wrap.value.clientWidth / 2, y: wrap.value.clientHeight / 2 };
  const world = { x: (point.x - pan.value.x) / zoom.value, y: (point.y - pan.value.y) / zoom.value };
  zoom.value = clampZoom(nextZoom);
  pan.value = { x: point.x - world.x * zoom.value, y: point.y - world.y * zoom.value };
}

function zoomIn() {
  zoomAtCenter(zoom.value * 1.25);
}

function zoomOut() {
  zoomAtCenter(zoom.value * .8);
}

function resetView() {
  zoom.value = 1;
  centerAt();
}

function setZoom(nextZoom: number) {
  zoomAtCenter(nextZoom);
}

function startPan(event: PointerEvent) {
  if(event.button !== 1 && !(event.button === 0 && event.altKey)) return;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  panPointerId = event.pointerId;
  panStart = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y };
  panning.value = true;
  event.preventDefault();
}

function movePan(event: PointerEvent) {
  if(event.pointerId !== panPointerId || !panStart) return;
  pan.value = { x: panStart.panX + event.clientX - panStart.x, y: panStart.panY + event.clientY - panStart.y };
}

function endPan(event: PointerEvent) {
  if(event.pointerId !== panPointerId) return;
  const target = event.currentTarget as HTMLElement;
  if(target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  panPointerId = null;
  panStart = null;
  panning.value = false;
}

function activeLayer() {
  function find(layers: any[]): any | null {
    for(const layer of layers) {
      if(layer.id === props.activeLayerId) return layer;
      if(layer.type === "group") {
        const nested = find(layer.layers);
        if(nested) return nested;
      }
    }
    return null;
  }
  return find(props.state?.layers ?? []);
}

function paintAt(event: PointerEvent) {
  const layer = activeLayer();
  if(!layer || layer.type !== "tile" || !wrap.value) return;
  const view = flattenTileLayers(props.state.layers).find(candidate => candidate.id === layer.id) ?? layer;
  const point = worldPoint(event);
  if(!point) return;
  const spacing = Math.min(8, Math.max(1, props.brushSpacing || 1));
  const target = lastBrushCell
    ? nearestIsoBrushCell(point, brushAnchor!, view, props.state.scene, spacing)
    : snapBrushCell(point, view, props.state.scene);
  if(!target || (lastBrushCell?.x === target.x && lastBrushCell?.y === target.y)) return;
  if(!brushAnchor) brushAnchor = { ...target };
  const cells = lastBrushCell
    ? interpolateIsoBrushCells(lastBrushCell, target, brushAnchor, spacing)
    : [target];
  lastBrushCell = target;
  for(const cell of cells) emit("paint", { ...cell, clear: false, point });
}

function worldPoint(event: PointerEvent) {
  if(!wrap.value) return null;
  const bounds = wrap.value.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left - pan.value.x) / zoom.value,
    y: (event.clientY - bounds.top - pan.value.y) / zoom.value,
  };
}

function startPaint(event: PointerEvent) {
  if(event.button !== 0 && event.button !== 2) return;
  if(event.button === 0 && ["select", "object", "entity", "player", "enemy"].includes(props.activeTool)) {
    const point = worldPoint(event);
    if(point) emit("action", { tool: props.activeTool, point });
    return;
  }
  const erasing = event.button === 2 || props.activeTool === "erase";
  if(props.activeTool !== "tile" && !erasing) return;
  if(event.altKey) return;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  paintPointerId = event.pointerId;
  lastPaintCell = null;
  brushAnchor = null;
  lastBrushCell = null;
  strokeErases = erasing;
  emit("stroke-start", erasing);
  if(erasing) {
    const point = worldPoint(event);
    if(point) eraseAt(point);
  } else {
    paintAt(event);
  }
  event.preventDefault();
}

function movePaint(event: PointerEvent) {
  if(event.pointerId !== paintPointerId) return;
  if(props.activeTool === "erase" || (event.buttons & 2) !== 0) {
    const point = worldPoint(event);
    if(point) eraseAt(point);
  } else {
    paintAt(event);
  }
}

function eraseAt(point: { x: number; y: number }) {
  const key = `${Math.floor(point.x / props.state.scene.gridWidth)},${Math.floor(point.y / props.state.scene.gridHeight)}`;
  if(key === lastPaintCell) return;
  lastPaintCell = key;
  emit("action", { tool: "erase", point });
}

function endPaint(event: PointerEvent) {
  if(event.pointerId !== paintPointerId) return;
  const target = event.currentTarget as HTMLElement;
  if(target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  paintPointerId = null;
  lastPaintCell = null;
  brushAnchor = null;
  lastBrushCell = null;
  emit("stroke-end", strokeErases);
}

async function renderScene(state: any, fit = false) {
  if(!renderer || !state) return;
  try {
    const layer = activeLayer();
    const hover = props.activeTool === "tile" && props.selectedMetatileId && layer?.type === "tile" ? {
      metatileId: props.selectedMetatileId,
      layerId: layer.id,
      flipX: props.flipX,
      flipY: props.flipY,
    } : null;
    await renderer.setOptions({
      showGrid: props.showGrid,
      showFootprints: props.showFootprints,
      hover,
      snapHover: true,
      hoverOpacity: .55,
      selectedObjectId: props.selection?.kind === "object" ? props.selection.id : null,
      selectedEntityId: props.selection?.kind === "entity" ? props.selection.id : null,
    });
    await renderer.setState(state);
    if(fit) {
      await nextTick();
      fitView();
    }
  } catch(error: any) {
    emit("error", error?.message ?? "Could not render the scene.");
  }
}

onMounted(async () => {
  if(!canvas.value) return;
  renderer = createSceneRenderer(canvas.value);
  resizeObserver = new ResizeObserver(() => fitView());
  if(wrap.value) resizeObserver.observe(wrap.value);
  await renderScene(props.state, true);
});

watch(() => props.state, state => renderScene(state));
watch(() => [props.showGrid, props.showFootprints, props.activeLayerId, props.selectedMetatileId, props.flipX, props.flipY, props.activeTool, props.selection], () => renderScene(props.state));
watch(zoom, value => emit("zoom-change", value));

onBeforeUnmount(() => {
  renderer?.dispose();
  resizeObserver?.disconnect();
  renderer = null;
});

defineExpose({ fitView, resetView, setZoom, zoomIn, zoomOut });
</script>

<template>
  <section class="panel canvas-panel" aria-label="Scene canvas">
    <div class="canvas-toolbar">
      <div class="tool-group" aria-label="History controls">
        <button class="action icon-action" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="$emit('undo')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 14-5-5 5-5" /><path d="M4 9h10a6 6 0 1 1 0 12h-3" /></svg></button>
        <button class="action icon-action" type="button" aria-label="Redo" title="Redo (Ctrl+Y)" :disabled="!canRedo" @click="$emit('redo')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 1 0 0 12h3" /></svg></button>
      </div>
      <ToolGroup :model-value="activeTool" @update:model-value="$emit('update:activeTool', $event)" />
    </div>
    <div ref="wrap" class="canvas-wrap" :class="{ panning }" @wheel.prevent="zoomAtPointer" @contextmenu.prevent @pointerdown="startPan($event); startPaint($event)" @pointermove="movePan($event); movePaint($event)" @pointerup="endPan($event); endPaint($event)" @pointercancel="endPan($event); endPaint($event)">
      <div class="canvas-stage" :style="stageStyle">
        <canvas id="mapCanvas" ref="canvas" :style="canvasStyle" tabindex="0" aria-label="Scene tile map" />
      </div>
    </div>
  </section>
</template>
