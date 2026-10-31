<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useWorkspaceDockLayout } from "../../composables/use-workspace-dock-layout";

const props = defineProps<{ sprites: any[]; selectedId: string; sourceUrls: Map<string, string>; busy?: boolean; zoom: number; canUndo: boolean; canRedo: boolean; historyEntries: { revision: number; label: string }[]; historyIndex: number }>();
const emit = defineEmits(["import", "create-blank", "remove", "rename", "select", "update", "zoom-change", "undo", "redo", "history", "go-to-history"]);
const canvas = ref<HTMLCanvasElement | null>(null);
const previewCanvas = ref<HTMLCanvasElement | null>(null);
const backgroundInput = ref<HTMLInputElement | null>(null);
const paletteInput = ref<HTMLInputElement | null>(null);
const selectedLayerId = ref("");
const palette = ref(["#000000", "#ffffff", "#7b1e1e", "#d9573f", "#e8b04a", "#8cab4b", "#377f68", "#3d6f9e", "#553f79", "#9b5b92", "#6a4a2f", "#8f6947", "#4b4f55", "#7f8587", "#b6b6a1", "#d8d8c4"]);
const selectedColorIndex = ref(1);
const dockPanels = [
  { id: "library", label: "Sprites", class: "sprite-library" },
  { id: "layers", label: "Layers" },
  { id: "history", label: "History", class: "history-panel" },
  { id: "preview", label: "Preview", class: "sprite-preview-panel sprite-asset-preview-panel" },
  { id: "palette", label: "Palette", class: "sprite-palette-panel" },
];
const dockLayout = useWorkspaceDockLayout("bonka.workspace-layout.sprite-asset.v1", {
  left: [{ key: "library", tabs: ["library"] }, { key: "layers", tabs: ["layers"] }, { key: "history", tabs: ["history"] }],
  right: [{ key: "preview", tabs: ["preview"] }, { key: "palette", tabs: ["palette"] }],
});
const activeTool = ref<"pen" | "eraser" | "eyedropper" | "selection">("pen");
const selection = ref<{ x: number; y: number; width: number; height: number } | null>(null);
const previewZoom = ref(1);
const interaction = ref<"draw" | "move" | "select" | "selection-move" | null>(null);
let moveStart: { x: number; y: number; offset: { x: number; y: number } } | null = null;
let selectionStart: { x: number; y: number } | null = null;
let selectionMoveStart: { x: number; y: number; selection: { x: number; y: number; width: number; height: number } } | null = null;
let erase = false;
const selected = computed(() => props.sprites.find(sprite => sprite.id === props.selectedId) ?? null);
const authoring = computed(() => selected.value?.authoring ?? null);
const activeLayer = computed(() => authoring.value?.layers.find((layer: any) => layer.id === selectedLayerId.value) ?? null);
const activeDrawingLayer = computed(() => authoring.value?.layers.find((layer: any) => layer.kind === "drawing") ?? null);
const activeReferenceLayer = computed(() => activeLayer.value?.kind === "reference" ? activeLayer.value : authoring.value?.layers.find((layer: any) => layer.kind === "reference") ?? null);
const selectedColor = computed(() => palette.value[selectedColorIndex.value]);

function makeLayer(id: string, name: string, kind: "drawing" | "reference", width: number, height: number, pixels = Array(width * height).fill(null)) {
  return { id, name, kind, visible: true, opacity: 1, scale: 1, offset: { x: 0, y: 0 }, width, height, pixels };
}

function hex(r: number, g: number, b: number) {
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

function sourceSize(sprite: any) {
  return sprite.layout
    ? { width: sprite.layout.imageWidth, height: sprite.layout.imageHeight }
    : { width: sprite.frameSize.width * sprite.frameCount, height: sprite.frameSize.height };
}

function setTool(tool: "pen" | "eraser" | "eyedropper" | "selection") {
  activeTool.value = tool;
}

async function ensureAuthoring() {
  if(authoring.value) return structuredClone(authoring.value);
  const sprite = selected.value;
  if(!sprite) return null;
  const { width, height } = sourceSize(sprite);
  const pixels = Array(width * height).fill(null);
  const imageUrl = props.sourceUrls.get(`sprite:${sprite.id}`);
  if(imageUrl) {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const context = source.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, width, height).data;
    for(let index = 0; index < pixels.length; ++index) {
      const offset = index * 4;
      if(data[offset + 3]) pixels[index] = hex(data[offset], data[offset + 1], data[offset + 2]);
    }
  }
  return { version: 1, width, height, palette: [...palette.value], layers: [makeLayer("drawing-1", "Drawing", "drawing", width, height, pixels)] };
}

function render() {
  const value = authoring.value;
  const sprite = selected.value;
  if(!sprite) return;
  const { width, height } = value ?? sourceSize(sprite);
  renderCanvas(canvas.value, value, sprite, width, height, true, true);
  renderCanvas(previewCanvas.value, value, sprite, width, height, false, false);
}

function renderCanvas(target: HTMLCanvasElement | null, value: any, sprite: any, width: number, height: number, showSelection: boolean, includeReferenceLayers: boolean) {
  if(!(target instanceof HTMLCanvasElement)) return;
  target.width = width;
  target.height = height;
  const context = target.getContext("2d");
  if(!context) return;
  context.clearRect(0, 0, width, height);
  if(!value) {
    const imageUrl = props.sourceUrls.get(`sprite:${sprite.id}`);
    if(!imageUrl) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0);
    image.src = imageUrl;
    return;
  }
  for(const layer of value.layers) {
    if(includeReferenceLayers || layer.kind === "drawing") renderLayer(context, layer, value.width, true);
  }
  if(showSelection && selection.value) {
    context.setLineDash([1, 1]);
    context.strokeStyle = "#e7b650";
    context.strokeRect(selection.value.x + .5, selection.value.y + .5, selection.value.width - 1, selection.value.height - 1);
    context.setLineDash([]);
  }
}

function renderLayer(context: CanvasRenderingContext2D, layer: any, fallbackWidth: number, includeOpacity: boolean) {
  if(!layer.visible) return;
  const width = layer.width ?? fallbackWidth;
  const offset = layer.offset ?? { x: 0, y: 0 };
  const scale = layer.kind === "reference" ? (layer.scale ?? 1) : 1;
  context.globalAlpha = includeOpacity ? (layer.opacity ?? 1) : 1;
  for(let index = 0; index < layer.pixels.length; ++index) {
    if(!layer.pixels[index]) continue;
    context.fillStyle = layer.pixels[index];
    context.fillRect((index % width) * scale + offset.x, Math.floor(index / width) * scale + offset.y, scale, scale);
  }
  context.globalAlpha = 1;
}

function commitHistory(value: any, label: string) {
  if(selected.value) emit("history", { id: selected.value.id, authoring: structuredClone(value), label });
}

function updateAuthoring(value: any, _updateImage = true, record = true, label = "Edit sprite") {
  const next = structuredClone(selected.value);
  next.authoring = value;
  emit("update", next);
  nextTick(render);
  if(record) commitHistory(value, label);
}

function canvasPixel(event: PointerEvent) {
  const value = authoring.value ?? sourceSize(selected.value);
  const target = canvas.value;
  if(!value || !target) return null;
  const bounds = target.getBoundingClientRect();
  const width = value.width;
  const height = value.height;
  const x = Math.floor((event.clientX - bounds.left) * width / bounds.width);
  const y = Math.floor((event.clientY - bounds.top) * height / bounds.height);
  return x >= 0 && y >= 0 && x < width && y < height ? { x, y, index: y * width + x } : null;
}

async function paint(event: PointerEvent) {
  const point = canvasPixel(event);
  if(!point) return;
  const value = await ensureAuthoring();
  if(!value) return;
  if(!selectedLayerId.value) selectedLayerId.value = value.layers[0].id;
  const layer = value.layers.find((item: any) => item.kind === "drawing");
  if(!layer) return;
  if(event.altKey && event.button === 2) {
    const color = referenceColorAt(value, point.x, point.y);
    if(color) {
      palette.value[selectedColorIndex.value] = color;
      persistPalette("Pick palette color");
    }
    return;
  }
  layer.pixels[point.index] = erase ? null : selectedColor.value;
  updateAuthoring(value, true, false);
}

function referenceColorAt(value: any, x: number, y: number) {
  for(const layer of [...value.layers].reverse()) {
    if(layer.kind !== "reference" || !layer.visible) continue;
    const width = layer.width ?? value.width;
    const height = layer.height ?? value.height;
    const offset = layer.offset ?? { x: 0, y: 0 };
    const scale = layer.scale ?? 1;
    const localX = Math.floor((x - offset.x) / scale);
    const localY = Math.floor((y - offset.y) / scale);
    if(localX < 0 || localY < 0 || localX >= width || localY >= height) continue;
    const color = layer.pixels[localY * width + localX];
    if(color) return color;
  }
  return null;
}

function pickVisibleColor(point: { x: number; y: number }) {
  const color = canvas.value?.getContext("2d")?.getImageData(point.x, point.y, 1, 1).data;
  if(!color?.[3]) return;
  palette.value[selectedColorIndex.value] = hex(color[0], color[1], color[2]);
  if(authoring.value) persistPalette("Pick palette color");
}

async function onPointerDown(event: PointerEvent) {
  event.preventDefault();
  if(event.button !== 0 && event.button !== 2) return;
  canvas.value?.setPointerCapture(event.pointerId);
  if(activeTool.value === "eyedropper" && event.button === 0) {
    const point = canvasPixel(event);
    if(point) pickVisibleColor(point);
    activeTool.value = "pen";
    return;
  }
  if(activeTool.value === "selection" && event.button === 0) {
    const point = canvasPixel(event);
    if(!point) return;
    if(!authoring.value) {
      const value = await ensureAuthoring();
      if(!value) return;
      updateAuthoring(value, true, false);
    }
    if(selection.value && point.x >= selection.value.x && point.x < selection.value.x + selection.value.width && point.y >= selection.value.y && point.y < selection.value.y + selection.value.height) {
      interaction.value = "selection-move";
      selectionMoveStart = { x: point.x, y: point.y, selection: { ...selection.value } };
    } else {
      interaction.value = "select";
      selectionStart = { x: point.x, y: point.y };
      selection.value = { x: point.x, y: point.y, width: 1, height: 1 };
      nextTick(render);
    }
    return;
  }
  if(event.altKey && event.button === 0 && activeReferenceLayer.value) {
    const point = canvasPixel(event);
    if(!point) return;
    interaction.value = "move";
    moveStart = { x: point.x, y: point.y, offset: { ...(activeReferenceLayer.value.offset ?? { x: 0, y: 0 }) } };
    return;
  }
  interaction.value = event.altKey ? null : "draw";
  erase = event.button === 2 || activeTool.value === "eraser";
  if(interaction.value === "draw") {
    const value = await ensureAuthoring();
  }
  paint(event);
}

function onPointerMove(event: PointerEvent) {
  if(interaction.value === "draw") paint(event);
  if(interaction.value === "select" && selectionStart) {
    const point = canvasPixel(event);
    if(!point) return;
    selection.value = { x: Math.min(selectionStart.x, point.x), y: Math.min(selectionStart.y, point.y), width: Math.abs(point.x - selectionStart.x) + 1, height: Math.abs(point.y - selectionStart.y) + 1 };
    nextTick(render);
  }
  if(interaction.value === "selection-move" && selectionMoveStart) {
    const point = canvasPixel(event);
    const value = authoring.value;
    if(!point || !value) return;
    const source = selectionMoveStart.selection;
    selection.value = { ...source, x: Math.max(0, Math.min(value.width - source.width, source.x + point.x - selectionMoveStart.x)), y: Math.max(0, Math.min(value.height - source.height, source.y + point.y - selectionMoveStart.y)) };
    nextTick(render);
  }
  if(interaction.value === "move" && moveStart && activeReferenceLayer.value) {
    const point = canvasPixel(event);
    if(!point) return;
    const value = structuredClone(authoring.value);
    const layer = value.layers.find((item: any) => item.id === activeReferenceLayer.value.id);
    layer.offset = { x: moveStart.offset.x + point.x - moveStart.x, y: moveStart.offset.y + point.y - moveStart.y };
    updateAuthoring(value, false, false);
  }
}

function moveSelectedPixels(source: { x: number; y: number; width: number; height: number }, target: { x: number; y: number; width: number; height: number }) {
  if(source.x === target.x && source.y === target.y) return;
  const value = structuredClone(authoring.value);
  const layer = value.layers.find((item: any) => item.kind === "drawing");
  if(!layer) return;
  const pixels = structuredClone(layer.pixels);
  for(let y = 0; y < source.height; ++y) for(let x = 0; x < source.width; ++x) layer.pixels[(source.y + y) * value.width + source.x + x] = null;
  for(let y = 0; y < source.height; ++y) for(let x = 0; x < source.width; ++x) layer.pixels[(target.y + y) * value.width + target.x + x] = pixels[(source.y + y) * value.width + source.x + x];
  updateAuthoring(value, true, false);
}

async function addLayer(kind: "drawing" | "reference") {
  const value = await ensureAuthoring();
  if(!value) return;
  const id = `${kind}-${value.layers.length + 1}`;
  value.layers.push(makeLayer(id, kind === "drawing" ? "Drawing" : "Reference", kind, value.width, value.height));
  selectedLayerId.value = id;
  updateAuthoring(value, true, true, `Add ${kind} layer`);
}

function toggleLayer(id: string) {
  const value = structuredClone(authoring.value);
  const layer = value.layers.find((item: any) => item.id === id);
  if(layer) layer.visible = !layer.visible;
  updateAuthoring(value, layer.kind === "drawing", true, `${layer.visible ? "Show" : "Hide"} layer`);
}

function removeLayer(id: string) {
  const value = structuredClone(authoring.value);
  const layer = value.layers.find((item: any) => item.id === id);
  if(!layer || (layer.kind === "drawing" && value.layers.filter((item: any) => item.kind === "drawing").length === 1)) return;
  value.layers = value.layers.filter((item: any) => item.id !== id);
  selectedLayerId.value = value.layers.find((item: any) => item.kind === "drawing")?.id ?? value.layers[0]?.id ?? "";
  updateAuthoring(value, layer.kind === "drawing", true, "Delete layer");
}

watch(selected, () => {
  selectedLayerId.value = authoring.value?.layers[0]?.id ?? "";
  if(authoring.value?.palette?.length) palette.value = [...authoring.value.palette];
  nextTick(render);
}, { immediate: true });
watch(authoring, () => nextTick(render), { deep: true });
function setLayerOpacity(id: string, value: string | number) {
  const next = structuredClone(authoring.value);
  const layer = next.layers.find((item: any) => item.id === id);
  layer.opacity = Number(value);
  updateAuthoring(next, false, true, "Change layer opacity");
}

async function importBackground(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if(!file || !selected.value) return;
  const image = new Image();
  image.src = URL.createObjectURL(file);
  await image.decode();
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const context = source.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, source.width, source.height).data;
  const pixels = Array(source.width * source.height).fill(null);
  for(let index = 0; index < pixels.length; ++index) {
    const offset = index * 4;
    if(data[offset + 3]) pixels[index] = hex(data[offset], data[offset + 1], data[offset + 2]);
  }
  URL.revokeObjectURL(image.src);
  const value = await ensureAuthoring();
  if(!value) return;
  const id = `background-${value.layers.filter((layer: any) => layer.kind === "reference").length + 1}`;
  value.layers.unshift(makeLayer(id, "Background", "reference", source.width, source.height, pixels));
  selectedLayerId.value = id;
  updateAuthoring(value, false, true, "Import background");
  (event.target as HTMLInputElement).value = "";
}

function setZoom(zoom: number) {
  emit("zoom-change", Math.max(.25, Math.min(32, zoom)));
}

function onWheel(event: WheelEvent) {
  const delta = event.deltaY || event.deltaX;
  if(event.shiftKey && activeDrawingLayer.value) {
    const value = structuredClone(authoring.value);
    const layer = value.layers.find((item: any) => item.id === activeDrawingLayer.value.id);
    layer.opacity = Math.max(0, Math.min(1, (layer.opacity ?? 1) + (delta < 0 ? .05 : -.05)));
    updateAuthoring(value, false);
    return;
  }
  if(event.ctrlKey && activeReferenceLayer.value) {
    const value = structuredClone(authoring.value);
    const layer = value.layers.find((item: any) => item.id === activeReferenceLayer.value.id);
    layer.opacity = Math.max(0, Math.min(1, (layer.opacity ?? 1) + (delta < 0 ? .05 : -.05)));
    updateAuthoring(value, false);
    return;
  }
  if(event.altKey && activeReferenceLayer.value) {
    const value = structuredClone(authoring.value);
    const layer = value.layers.find((item: any) => item.id === activeReferenceLayer.value.id);
    layer.scale = Math.max(.1, Math.min(16, (layer.scale ?? 1) * (delta < 0 ? 1.1 : 1 / 1.1)));
    updateAuthoring(value, false);
    return;
  }
  setZoom(props.zoom * (delta < 0 ? 1.1 : 1 / 1.1));
}

function finishInteraction() {
  if(interaction.value === "selection-move" && selectionMoveStart && selection.value) moveSelectedPixels(selectionMoveStart.selection, selection.value);
  if(interaction.value) {
    commitHistory(authoring.value, erase ? "Erase sprite" : interaction.value === "draw" ? "Paint sprite" : "Move selection");
  }
  interaction.value = null;
  selectionStart = null;
  selectionMoveStart = null;
  erase = false;
}

function addPaletteColor(event: Event) {
  const color = (event.target as HTMLInputElement).value;
  palette.value.push(color);
  selectedColorIndex.value = palette.value.length - 1;
  persistPalette("Add palette color");
}

function removePaletteColor(index: number) {
  if(palette.value.length === 1) return;
  palette.value.splice(index, 1);
  selectedColorIndex.value = Math.min(selectedColorIndex.value, palette.value.length - 1);
  persistPalette("Remove palette color");
}

function persistPalette(label: string) {
  const value = structuredClone(authoring.value);
  if(!value) return;
  value.palette = [...palette.value];
  updateAuthoring(value, false, true, label);
}

function undo() {
  emit("undo");
}

function redo() {
  emit("redo");
}

onBeforeUnmount(() => { interaction.value = null; });

defineExpose({
  zoomOut: () => setZoom(props.zoom - .25),
  zoomIn: () => setZoom(props.zoom + .25),
  resetView: () => setZoom(1),
  fitView: () => setZoom(1),
  setZoom,
  undo,
  redo,
});
</script>

<template>
  <section class="workspace-layout sprite-asset-editor" aria-label="Sprite asset editor">
    <WorkspaceDocks :panels="dockPanels" :layout="dockLayout" left-label="Sprite resources" right-label="Sprite preview and palette">
      <template #library><PanelLibrarySprite :sprites="sprites" :selected-id="selectedId" :source-urls="sourceUrls" :busy="busy" @import="emit('import', $event)" @create="emit('create-blank')" @remove="emit('remove', $event)" @rename="(id, name) => emit('rename', id, name)" @select="emit('select', $event)" /></template>
      <template #layers>
         <p v-if="!selected" class="empty-note">Select a sprite to view its layers.</p>
         <p v-else-if="!authoring" class="empty-note">No layers yet. Paint the sprite to begin.</p>
        <div v-else class="sprite-authoring-layers">
          <div v-for="layer in [...authoring.layers].reverse()" :key="layer.id" class="sprite-layer-row" :class="{ active: layer.id === selectedLayerId }">
            <button class="visibility-button layer-icon" type="button" :title="layer.visible ? 'Hide layer' : 'Show layer'" :aria-label="layer.visible ? 'Hide layer' : 'Show layer'" @click="toggleLayer(layer.id)">
              <EditorIcon :name="layer.visible ? 'eye' : 'eye-off'" />
            </button>
            <span class="layer-type-icon" :title="layer.kind === 'drawing' ? 'Drawing layer' : 'Background layer'">
              <EditorIcon :name="layer.kind === 'drawing' ? 'brush' : 'image'" />
            </span>
            <button class="layer-select" type="button" @click="selectedLayerId = layer.id"><strong>{{ layer.name }}</strong><span>{{ layer.kind === 'drawing' ? 'Drawing' : 'Background' }}</span></button>
            <button class="action danger icon-action sprite-layer-delete" type="button" :disabled="layer.kind === 'drawing' && authoring.layers.filter((item: any) => item.kind === 'drawing').length === 1" aria-label="Delete layer" title="Delete layer" @click="removeLayer(layer.id)"><EditorIcon name="trash" /></button>
          </div>
          <div class="sprite-layer-actions"><button class="action" type="button" @click="addLayer('drawing')">+ Drawing</button><button class="action" type="button" @click="addLayer('reference')">+ Reference</button><button class="action" type="button" @click="backgroundInput?.click()">Import</button></div>
          <button v-if="activeLayer" class="action" type="button" @click="toggleLayer(activeLayer.id)">{{ activeLayer.visible ? 'Hide' : 'Show' }} layer</button>
          <label v-if="activeDrawingLayer" class="field field-stack"><span>Drawing opacity</span><input type="range" min="0" max="1" step=".05" :value="activeDrawingLayer.opacity ?? 1" @input="setLayerOpacity(activeDrawingLayer.id, ($event.target as HTMLInputElement).value)"></label>
          <label v-if="activeReferenceLayer" class="field field-stack"><span>Background opacity</span><input type="range" min="0" max="1" step=".05" :value="activeReferenceLayer.opacity ?? 1" @input="setLayerOpacity(activeReferenceLayer.id, ($event.target as HTMLInputElement).value)"></label>
         </div>
         <input ref="backgroundInput" type="file" accept="image/*" hidden @change="importBackground">
      </template>
      <template #history><PanelHistory :entries="historyEntries" :current-index="historyIndex" @go-to="emit('go-to-history', $event)" /></template>
      <template #preview>
        <template v-if="selected">
          <div class="sprite-preview-actions">
            <button class="action" :class="{ active: previewZoom === .25 }" type="button" @click="previewZoom = .25">.25x</button>
            <button class="action" :class="{ active: previewZoom === .5 }" type="button" @click="previewZoom = .5">.5x</button>
            <button class="action" :class="{ active: previewZoom === 1 }" type="button" @click="previewZoom = 1">1x</button>
            <button class="action" :class="{ active: previewZoom === 2 }" type="button" @click="previewZoom = 2">2x</button>
            <button class="action" :class="{ active: previewZoom === 4 }" type="button" @click="previewZoom = 4">4x</button>
          </div>
          <canvas ref="previewCanvas" class="sprite-asset-preview" :style="{ width: `${(authoring?.width ?? sourceSize(selected).width) * previewZoom}px`, height: `${(authoring?.height ?? sourceSize(selected).height) * previewZoom}px` }" />
        </template>
      </template>
      <template #palette>
        <div v-for="(color, index) in palette" :key="index" class="sprite-color-wrap">
          <button class="sprite-color" :class="{ active: index === selectedColorIndex }" :style="{ backgroundColor: color }" :title="color" type="button" @click="selectedColorIndex = index" />
          <button class="sprite-color-remove" type="button" :disabled="palette.length === 1" :aria-label="`Remove ${color}`" :title="`Remove ${color}`" @click="removePaletteColor(index)">x</button>
        </div>
        <button class="sprite-color sprite-color-add" type="button" aria-label="Add palette color" title="Add palette color" @click="paletteInput?.click()">+</button>
        <input ref="paletteInput" type="color" hidden @change="addPaletteColor">
        <small>LMB draws on the sprite. RMB erases. Alt+RMB copies the background color into the selected palette slot. Alt+LMB drags, Alt+scroll scales the selected background, Shift+scroll changes drawing opacity and Ctrl+scroll changes background opacity.</small>
      </template>
    </WorkspaceDocks>
    <template v-if="selected">
      <section class="panel sprite-pixel-panel workspace-region--main" aria-label="Sprite canvas">
        <div class="canvas-toolbar">
          <div class="tool-group" aria-label="History controls">
            <button class="action icon-action" type="button" aria-label="Undo" title="Undo" :disabled="!canUndo" @click.stop="undo"><EditorIcon name="undo" /></button>
            <button class="action icon-action" type="button" aria-label="Redo" title="Redo" :disabled="!canRedo" @click.stop="redo"><EditorIcon name="redo" /></button>
          </div>
          <div class="tool-group sprite-tools" aria-label="Sprite tools">
            <button class="action icon-action" :class="{ active: activeTool === 'pen' }" type="button" aria-label="Pen" title="Draw" :aria-pressed="activeTool === 'pen'" @click="setTool('pen')"><EditorIcon name="pen" /></button>
            <button class="action icon-action" :class="{ active: activeTool === 'eraser' }" type="button" aria-label="Eraser" title="Erase" :aria-pressed="activeTool === 'eraser'" @click="setTool('eraser')"><EditorIcon name="eraser" /></button>
            <button class="action icon-action" :class="{ active: activeTool === 'eyedropper' }" type="button" aria-label="Eyedropper" title="Pick visible canvas color" :aria-pressed="activeTool === 'eyedropper'" @click="setTool('eyedropper')"><EditorIcon name="eyedropper" /></button>
            <button class="action icon-action" :class="{ active: activeTool === 'selection' }" type="button" aria-label="Selection tool" title="Select and move drawing pixels" :aria-pressed="activeTool === 'selection'" @click="setTool('selection')"><EditorIcon name="select" /></button>
          </div>
        </div>
        <div class="sprite-pixel-content"><canvas ref="canvas" class="sprite-pixel-canvas" :style="{ width: `${(authoring?.width ?? sourceSize(selected).width) * zoom}px`, height: `${(authoring?.height ?? sourceSize(selected).height) * zoom}px` }" @contextmenu.prevent @wheel.prevent="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="finishInteraction" @pointercancel="finishInteraction" /></div>
      </section>
    </template>
    <p v-else class="empty-note workspace-region--main">Create or import a PNG sprite to begin.</p>
  </section>
</template>
