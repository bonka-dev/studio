<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

import {
  closeBrowserProject,
  createBrowserProject,
  importPngTilesets,
  openBrowserProject,
  saveBrowserProject,
} from "./lib/io/browser-project-loader.mjs";
import { addEntityDefinition, addEntityInstance, addMetatile, applyEditorState, projectToEditorState, removeEntityInstance } from "./lib/project/editor-project.mjs";
import { createGroup, createHistory, createObjectLayer, createTileLayer, getLayerParent, moveLayer, removeLayer, traverseLayers } from "./lib/workspace/editor-commands.mjs";
import { cellFromPixel, flattenObjectLayers, flattenTileLayers, removePlacement, upsertPlacement } from "./lib/canvas/scene-renderer.mjs";

type DirectoryPicker = (options: { mode: "readwrite" }) => Promise<any>;

const project = shallowRef<any>(null);
const editorState = shallowRef<any>(null);
const busy = shallowRef(false);
const saving = shallowRef(false);
const dirty = shallowRef(false);
const showSaved = ref(false);
const commandsOpen = ref(false);
const activeLayerId = ref<string | null>(null);
const canvasZoom = ref(1);
const sceneCanvas = ref<any>(null);
const status = shallowRef("Choose a project directory to continue.");
const tilesets = computed(() => editorState.value?.tilesets ?? []);
const selectedTile = ref<{ tileset: string; tile: number } | null>(null);
const selectedMetatileId = ref<string | null>(null);
const metatileMode = ref<"tiles" | "collision">("tiles");
const showGrid = ref(true);
const showFootprints = ref(false);
const flipX = ref(false);
const flipY = ref(false);
const brushSpacing = ref(1);
const activeTool = ref("tile");
const selection = ref<{ kind: "object" | "entity"; id: string; layerId?: string } | null>(null);
const selectedEntityDefinitionId = ref("");
const entityVersion = ref(0);
const historyVersion = ref(0);
let history: ReturnType<typeof createHistory> | null = null;
let stroke: { erase: boolean; changed: boolean } | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
const historyEntries = computed(() => {
  historyVersion.value;
  return history?.entries().map(entry => ({ label: entry.label })) ?? [];
});
const historyIndex = computed(() => {
  historyVersion.value;
  return history?.index() ?? 0;
});
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < historyEntries.value.length - 1);
const activeLayer = computed(() => findLayer(editorState.value?.layers ?? [], activeLayerId.value ?? ""));
useHead(() => ({
  title: project.value
    ? `${dirty.value ? "* " : ""}${editorState.value?.projectName || "Untitled Project"} • Bonka`
    : "Bonka Editor",
  link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
}));
const entityDefinitions = computed(() => {
  entityVersion.value;
  return [...(project.value?.entities?.values() ?? [])];
});
const selectedItem = computed(() => {
  if(!selection.value || !editorState.value) return null;
  return selection.value.kind === "entity"
    ? editorState.value.entities.find((item: any) => item.id === selection.value?.id) ?? null
    : findLayer(editorState.value.layers, selection.value.layerId ?? "")?.objects.find((item: any) => item.id === selection.value?.id) ?? null;
});

function directoryPicker(): DirectoryPicker | null {
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker ?? null;
}

async function chooseDirectory() {
  const pickDirectory = directoryPicker();
  if(!pickDirectory) throw new Error("This browser does not support folder access. Use a current Chromium-based browser.");
  return pickDirectory({ mode: "readwrite" });
}

function adoptProject(nextProject: any, message: string) {
  if(project.value) closeBrowserProject(project.value);
  project.value = nextProject;
  editorState.value = projectToEditorState(nextProject, nextProject.sourceUrls);
  activeLayerId.value = findFirstTileLayer(editorState.value.layers);
  selectedTile.value = null;
  selectedMetatileId.value = editorState.value.metatiles[0]?.id ?? null;
  selectedEntityDefinitionId.value = [...nextProject.entities.keys()][0] ?? "";
  selection.value = null;
  entityVersion.value++;
  metatileMode.value = "tiles";
  resetHistory(editorState.value);
  status.value = message;
}

async function openProject() {
  await runProjectAction("Opening project...", async () => openBrowserProject(await chooseDirectory()), "Opened Project Format v1 project.");
}

async function createProject() {
  const name = window.prompt("Project name", "Bonka Project");
  if(name === null) return;
  const trimmedName = name.trim();
  if(!trimmedName) {
    status.value = "Enter a project name to create a project.";
    return;
  }
  await runProjectAction("Creating project...", async () => createBrowserProject(await chooseDirectory(), { name: trimmedName }), "Created Project Format v1 project.");
}

async function runProjectAction(message: string, action: () => Promise<any>, successMessage: string) {
  busy.value = true;
  status.value = message;
  try {
    adoptProject(await action(), successMessage);
  } catch(error: any) {
    status.value = error?.name === "AbortError" ? "Folder selection cancelled." : error?.message ?? "Could not open the selected project.";
  } finally {
    busy.value = false;
  }
}

function renameProject(value: string | number) {
  const name = String(value).trim() || "Untitled Project";
  commit({ ...editorState.value, projectName: name }, "Rename project");
  status.value = "Project name changed. Save to write files.";
}

function findFirstTileLayer(layers: any[]): string | null {
  for(const layer of layers) {
    if(layer.type === "tile") return layer.id;
    const nested = layer.type === "group" ? findFirstTileLayer(layer.layers) : null;
    if(nested) return nested;
  }
  return null;
}

function toggleLayerVisibility(id: string) {
  function update(layers: any[]): any[] {
    return layers.map(layer => {
      if(layer.id === id) return { ...layer, visible: layer.visible === false };
      if(layer.type === "group") return { ...layer, layers: update(layer.layers) };
      return layer;
    });
  }
  const layer = findLayer(editorState.value.layers, id);
  commit({ ...editorState.value, layers: update(editorState.value.layers) }, `${layer?.visible === false ? "Show" : "Hide"} ${layer?.name ?? "layer"}`);
  status.value = `${layer?.visible === false ? "Show" : "Hide"} ${layer?.name ?? "layer"}. Save to write files.`;
}

function patchActiveLayer(patch: Record<string, unknown>) {
  if(!activeLayerId.value) return;
  commit(updateLayer(activeLayerId.value, layer => ({ ...layer, ...patch })), `Edit ${activeLayer.value?.name ?? "layer"}`);
}

function updateLayer(id: string, transform: (layer: any) => any) {
  function update(layers: any[]): any[] {
    return layers.map(layer => {
      if(layer.id === id) return transform(layer);
      if(layer.type === "group") return { ...layer, layers: update(layer.layers) };
      return layer;
    });
  }
  return { ...editorState.value, layers: update(editorState.value.layers) };
}

function clearActiveLayer() {
  const layer = activeLayer.value;
  if(!layer || layer.type === "group" || (!layer.placements.length && !layer.objects.length)) return;
  if(!window.confirm(`Clear all content from '${layer.name}'?`)) return;
  commit(updateLayer(layer.id, item => ({ ...item, placements: [], objects: [] })), `Clear ${layer.name}`);
  status.value = `Cleared ${layer.name}. Save to write files.`;
}

function addLayer(type: "tile" | "object" | "group") {
  const nextState = type === "tile"
    ? createTileLayer(editorState.value)
    : type === "object"
      ? createObjectLayer(editorState.value)
      : createGroup(editorState.value);
  const layer = nextState.layers.at(-1);
  const label = type === "tile" ? "Add tile layer" : type === "object" ? "Add object layer" : "Add layer group";
  commit(nextState, label);
  activeLayerId.value = layer?.id ?? null;
  status.value = `${label}. Save to write files.`;
}

function deleteActiveLayer() {
  const layer = activeLayer.value;
  if(!layer || !window.confirm(`Delete '${layer.name}'?`)) return;
  const nextState = removeLayer(editorState.value, layer.id);
  commit(nextState, `Delete ${layer.name}`);
  activeLayerId.value = findFirstTileLayer(nextState.layers) ?? nextState.layers.at(-1)?.id ?? null;
  status.value = `Deleted ${layer.name}. Save to write files.`;
}

function moveLayerToTarget(movingId: string, targetId: string) {
  if(movingId === targetId) return;
  const target = findLayer(editorState.value.layers, targetId);
  if(!target) return;
  if(target.type === "group") {
    commit(moveLayer(editorState.value, movingId, target.id, target.layers.length), `Move layer into ${target.name}`);
    return;
  }
  const parent = getLayerParent(editorState.value.layers, target.id);
  const siblings = parent?.layers ?? editorState.value.layers;
  commit(moveLayer(editorState.value, movingId, parent?.id ?? null, siblings.findIndex(layer => layer.id === target.id)), `Move layer before ${target.name}`);
}

function setTool(tool: string) {
  if(tool === "object" && activeLayer.value?.type !== "object") {
    const objectLayer = traverseLayers(editorState.value.layers).find(layer => layer.type === "object");
    if(objectLayer) {
      activeLayerId.value = objectLayer.id;
    } else {
      const nextState = createObjectLayer(editorState.value);
      activeLayerId.value = traverseLayers(nextState.layers).at(-1)?.id ?? null;
      commit(nextState, "Add object layer");
    }
  }
  activeTool.value = tool;
}

function findLayer(layers: any[], id: string): any | null {
  for(const layer of layers) {
    if(layer.id === id) return layer;
    const nested = layer.type === "group" ? findLayer(layer.layers, id) : null;
    if(nested) return nested;
  }
  return null;
}

function resetHistory(state: any) {
  history = createHistory(state);
  historyVersion.value++;
  dirty.value = false;
}

function commit(state: any, label: string) {
  if(!history) history = createHistory(editorState.value);
  if(savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  showSaved.value = false;
  editorState.value = history.push(state, label);
  historyVersion.value++;
  dirty.value = history.isDirty();
}

function showSavedFeedback() {
  if(savedTimer) clearTimeout(savedTimer);
  showSaved.value = true;
  savedTimer = setTimeout(() => {
    showSaved.value = false;
    savedTimer = null;
  }, 2400);
}

function beginStroke(erase: boolean) {
  stroke = { erase, changed: false };
}

function applyStrokeChange(state: any, label: string) {
  if(!stroke) {
    commit(state, label);
    return;
  }
  editorState.value = state;
  stroke.changed = true;
}

function endStroke(erase: boolean) {
  if(stroke?.changed) commit(editorState.value, erase ? "Erase stroke" : "Paint tile stroke");
  stroke = null;
}

function goToHistory(index: number) {
  if(!history) return;
  editorState.value = history.goTo(index);
  historyVersion.value++;
  dirty.value = history.isDirty();
  if(!findLayer(editorState.value.layers, activeLayerId.value ?? "")) {
    activeLayerId.value = findFirstTileLayer(editorState.value.layers);
  }
}

function undo() {
  if(canUndo.value) goToHistory(historyIndex.value - 1);
}

function redo() {
  if(canRedo.value) goToHistory(historyIndex.value + 1);
}

function handleKeyboardShortcut(event: KeyboardEvent) {
  if(!project.value) return;
  const target = event.target as HTMLElement | null;
  if(target?.matches("input, select, textarea, [contenteditable='true']")) return;
  const key = event.key.toLowerCase();
  if((event.ctrlKey || event.metaKey) && key === "z") {
    event.preventDefault();
    if(event.shiftKey) redo(); else undo();
  } else if((event.ctrlKey || event.metaKey) && key === "y") {
    event.preventDefault();
    redo();
  } else if(!event.ctrlKey && !event.metaKey) {
    const tools: Record<string, string> = { s: "select", t: "tile", o: "object", n: "entity", p: "player", e: "enemy", x: "erase" };
    if(tools[key]) {
      event.preventDefault();
      setTool(tools[key]);
    }
  }
}

onMounted(() => window.addEventListener("keydown", handleKeyboardShortcut));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyboardShortcut);
  if(savedTimer) clearTimeout(savedTimer);
});

function setCanvasError(message: string) {
  status.value = message;
}

function paintMetatile({ x, y, clear, point }: { x: number; y: number; clear: boolean; point: { x: number; y: number } }) {
  const layer = activeLayer.value;
  if(!layer || layer.type !== "tile") {
    status.value = "Select or add a tile layer before painting.";
    return;
  }
  if(clear) {
    eraseAt(point);
    return;
  }
  const metatile = editorState.value.metatiles.find(item => item.id === selectedMetatileId.value);
  if(!metatile) {
    status.value = "Select or add a metatile before painting.";
    return;
  }
  if(metatile.columns * metatile.tileWidth !== editorState.value.scene.tileWidth || metatile.rows * metatile.tileHeight !== editorState.value.scene.tileHeight) {
    status.value = "Metatile dimensions must match the scene tile size.";
    return;
  }
  applyStrokeChange(updateLayer(layer.id, item => upsertPlacement(item, {
    metatileId: metatile.id,
    x,
    y,
    flipX: flipX.value,
    flipY: flipY.value,
    sourceHasFlip: flipX.value || flipY.value,
  })), `Paint ${metatile.name}`);
}

function eraseAt(point: { x: number; y: number }) {
  const globalCell = cellFromPixel(editorState.value, null, point.x, point.y);
  if(!globalCell) return;
  const next = structuredClone(editorState.value);
  let changed = false;
  for(const layer of flattenObjectLayers(next.layers)) {
    const cell = cellFromPixel(next, layer, point.x, point.y);
    if(!cell) continue;
    const target = findLayer(next.layers, layer.id);
    const objects = target.objects.filter((item: any) => item.x !== cell.x || item.y !== cell.y);
    if(objects.length !== target.objects.length) {
      target.objects = objects;
      changed = true;
    }
  }
  const entities = next.entities.filter((item: any) => item.x !== globalCell.x || item.y !== globalCell.y);
  if(entities.length !== next.entities.length) {
    next.entities = entities;
    changed = true;
  }
  const layer = activeLayer.value;
  if(layer?.type === "tile") {
    const view = flattenTileLayers(next.layers).find(candidate => candidate.id === layer.id) ?? layer;
    const cell = cellFromPixel(next, view, point.x, point.y);
    const target = findLayer(next.layers, layer.id);
    if(cell && target.placements.some((item: any) => item.x === cell.x && item.y === cell.y)) {
      target.placements = removePlacement(target, cell.x, cell.y).placements;
      changed = true;
    }
  }
  if(changed) {
    selection.value = null;
    applyStrokeChange(next, "Erase");
  }
}

function canvasAction({ tool, point }: { tool: string; point: { x: number; y: number } }) {
  if(tool === "select") selectAt(point);
  else if(tool === "object") placeObjectAt(point);
  else if(tool === "entity") placeEntityAt(point);
  else if(tool === "player" || tool === "enemy") placeEntityAt(point, tool);
  else if(tool === "erase") eraseAt(point);
}

function selectAt(point: { x: number; y: number }) {
  const layers = flattenObjectLayers(editorState.value.layers).filter(layer => layer.visible).reverse();
  for(const layer of layers) {
    const cell = cellFromPixel(editorState.value, layer, point.x, point.y);
    const object = cell && layer.objects.find((item: any) => item.x === cell.x && item.y === cell.y && item.visible !== false);
    if(object) {
      selection.value = { kind: "object", id: object.id, layerId: layer.id };
      activeLayerId.value = layer.id;
      return;
    }
  }
  const cell = cellFromPixel(editorState.value, null, point.x, point.y);
  const entity = cell && editorState.value.entities.find((item: any) => item.x === cell.x && item.y === cell.y);
  selection.value = entity ? { kind: "entity", id: entity.id } : null;
}

function placeObjectAt(point: { x: number; y: number }) {
  const layer = activeLayer.value;
  if(!layer || layer.type !== "object") {
    status.value = "Select or add an object layer before placing objects.";
    return;
  }
  const view = flattenObjectLayers(editorState.value.layers).find(candidate => candidate.id === layer.id) ?? layer;
  const cell = cellFromPixel(editorState.value, view, point.x, point.y);
  if(!cell) return;
  const next = structuredClone(editorState.value);
  let number = next.scene.nextObjectId++;
  const used = new Set(traverseLayers(next.layers).flatMap(item => item.objects?.map((object: any) => object.id) ?? []));
  while(used.has(`object-${number}`)) number = next.scene.nextObjectId++;
  const object = { id: `object-${number}`, kind: "object", name: `Object ${number}`, visible: true, ...cell };
  next.layers = updateLayer(layer.id, item => ({ ...item, objects: [...item.objects, object] })).layers;
  selection.value = { kind: "object", id: object.id, layerId: layer.id };
  commit(next, `Add ${object.name}`);
}

function ensureEntityDefinition(id: string, name: string) {
  const existing = project.value.entities.get(id);
  if(existing) return existing;
  applyEditorState(project.value, editorState.value);
  const definition = addEntityDefinition(project.value, { id, name });
  selectedEntityDefinitionId.value = definition.id;
  entityVersion.value++;
  return definition;
}

function addGenericEntityDefinition() {
  const name = window.prompt("Entity definition name", "Entity");
  if(name === null) return;
  try {
    applyEditorState(project.value, editorState.value);
    const definition = addEntityDefinition(project.value, { id: name, name: name.trim() || "Entity" });
    selectedEntityDefinitionId.value = definition.id;
    entityVersion.value++;
    commit(editorState.value, `Add ${definition.name} definition`);
    status.value = `Created generic entity definition '${definition.id}'. Save to write files.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not add the entity definition.";
  }
}

function placeEntityAt(point: { x: number; y: number }, preset: "player" | "enemy" | null = null) {
  const cell = cellFromPixel(editorState.value, null, point.x, point.y);
  if(!cell) return;
  const definition = preset ? ensureEntityDefinition(preset, preset === "player" ? "Player" : "Enemy") : project.value.entities.get(selectedEntityDefinitionId.value);
  if(!definition) {
    status.value = "Create or select an entity definition before placing an entity.";
    return;
  }
  const next = structuredClone(editorState.value);
  if(preset === "player") {
    const existing = next.entities.find((item: any) => item.definition === definition.id);
    if(existing) {
      Object.assign(existing, cell);
      selection.value = { kind: "entity", id: existing.id };
      commit(next, "Move Player entity");
      return;
    }
  }
  if(preset === "enemy") {
    const existing = next.entities.find((item: any) => item.definition === definition.id && item.x === cell.x && item.y === cell.y);
    if(existing) {
      removeEntityInstance(next, existing.id);
      selection.value = null;
      commit(next, "Remove Enemy entity");
      return;
    }
  }
  const instance = addEntityInstance(next, { definition: definition.id, ...cell });
  selection.value = { kind: "entity", id: instance.id };
  commit(next, `Add ${definition.name} entity`);
}

function patchSelection(patch: Record<string, unknown>) {
  const item = selectedItem.value;
  if(!item) return;
  if(("x" in patch && (!Number.isInteger(patch.x) || Number(patch.x) < 0 || Number(patch.x) >= editorState.value.scene.width)) || ("y" in patch && (!Number.isInteger(patch.y) || Number(patch.y) < 0 || Number(patch.y) >= editorState.value.scene.height))) {
    status.value = "Selection coordinates must be cells inside the scene.";
    return;
  }
  const next = structuredClone(editorState.value);
  if(selection.value?.kind === "entity") {
    const index = next.entities.findIndex((candidate: any) => candidate.id === item.id);
    next.entities[index] = { ...next.entities[index], ...patch };
  } else if(selection.value) {
    next.layers = updateLayer(selection.value.layerId!, layer => ({ ...layer, objects: layer.objects.map((candidate: any) => candidate.id === item.id ? { ...candidate, ...patch } : candidate) })).layers;
  }
  commit(next, "Edit selection");
}

function deleteSelection() {
  const item = selectedItem.value;
  if(!item || !selection.value) return;
  const next = structuredClone(editorState.value);
  if(selection.value.kind === "entity") removeEntityInstance(next, item.id);
  else next.layers = updateLayer(selection.value.layerId!, layer => ({ ...layer, objects: layer.objects.filter((candidate: any) => candidate.id !== item.id) })).layers;
  selection.value = null;
  commit(next, `Delete ${item.id}`);
}

async function importTilesets(files: File[]) {
  busy.value = true;
  try {
    applyEditorState(project.value, editorState.value);
    const imported = await importPngTilesets(project.value, files, { tileWidth: 8, tileHeight: 8 });
    commit(projectToEditorState(project.value, project.value.sourceUrls), `Import ${imported.length} tileset${imported.length === 1 ? "" : "s"}`);
    if(imported[0]) selectedTile.value = { tileset: imported[0].id, tile: 0 };
    status.value = `Imported ${imported.length} PNG tileset${imported.length === 1 ? "" : "s"}. Save to write files.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not import the selected PNG files.";
  } finally {
    busy.value = false;
  }
}

function selectTile(selection: { tileset: string; tile: number }) {
  selectedTile.value = selection;
  const tileset = tilesets.value.find(item => item.id === selection.tileset);
  status.value = `Selected ${tileset?.name ?? selection.tileset}, tile ${selection.tile}.`;
}

function addNewMetatile(options: { name: string; columns: number; rows: number }) {
  try {
    applyEditorState(project.value, editorState.value);
    const tileset = tilesets.value.find(item => item.id === selectedTile.value?.tileset);
    const metatile = addMetatile(project.value, {
      ...options,
      tileSize: { width: tileset?.tileWidth ?? 8, height: tileset?.tileHeight ?? 8 },
      tiles: Array(options.columns * options.rows).fill(null),
    });
    commit({
      ...editorState.value,
      metatiles: [...editorState.value.metatiles, {
        id: metatile.id,
        name: metatile.name,
        type: "metatile",
        columns: metatile.columns,
        rows: metatile.rows,
        tileWidth: metatile.tileSize.width,
        tileHeight: metatile.tileSize.height,
        visible: metatile.visible,
        opacity: metatile.opacity,
        data: structuredClone(metatile.tiles),
        collisionMap: [...metatile.collision],
      }],
    }, `Add ${metatile.name}`);
    selectedMetatileId.value = metatile.id;
    status.value = `Added ${metatile.name}. Save to write files.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not add the metatile.";
  }
}

function selectMetatile(id: string) {
  selectedMetatileId.value = id;
}

function activateMetatileCell({ index, clear }: { index: number; clear: boolean }) {
  const metatile = editorState.value.metatiles.find(item => item.id === selectedMetatileId.value);
  if(!metatile) return;
  if(metatileMode.value === "collision") {
    updateMetatile(metatile.id, item => {
      const collisionMap = [...item.collisionMap];
      collisionMap[index] = collisionMap[index] ? 0 : 1;
      return { ...item, collisionMap };
    });
    return;
  }
  if(clear) {
    updateMetatile(metatile.id, item => {
      const data = [...item.data];
      data[index] = null;
      return { ...item, data };
    });
    return;
  }
  if(!selectedTile.value) {
    status.value = "Select a tileset tile before painting a metatile cell.";
    return;
  }
  const tileset = tilesets.value.find(item => item.id === selectedTile.value?.tileset);
  if(!tileset || tileset.tileWidth !== metatile.tileWidth || tileset.tileHeight !== metatile.tileHeight) {
    status.value = "Selected tile dimensions must match the metatile tile size.";
    return;
  }
  updateMetatile(metatile.id, item => {
    const data = [...item.data];
    data[index] = { ...selectedTile.value };
    return { ...item, data };
  });
}

function updateMetatile(id: string, transform: (metatile: any) => any) {
  commit({
    ...editorState.value,
    metatiles: editorState.value.metatiles.map(item => item.id === id ? transform(item) : item),
  }, "Edit metatile");
}

async function saveProject() {
  busy.value = true;
  saving.value = true;
  try {
    applyEditorState(project.value, editorState.value);
    await saveBrowserProject(project.value);
    history?.markSaved();
    historyVersion.value++;
    dirty.value = false;
    showSavedFeedback();
    status.value = "Saved Project Format v1 project.";
  } catch(error: any) {
    status.value = error?.message ?? "Could not save the project.";
  } finally {
    saving.value = false;
    busy.value = false;
  }
}

function closeProject() {
  if(dirty.value && !window.confirm("Discard unsaved changes?")) return;
  closeBrowserProject(project.value);
  project.value = null;
  editorState.value = null;
  selectedTile.value = null;
  selectedMetatileId.value = null;
  dirty.value = false;
  showSaved.value = false;
  if(savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  history = null;
  historyVersion.value++;
  status.value = "Choose a project directory to continue.";
}
</script>

<template>
  <NuxtRouteAnnouncer />
  <main v-if="!project" class="project-hub">
    <section class="hub-card" aria-labelledby="hub-title">
      <p class="eyebrow">GBA project workspace</p>
      <h1 id="hub-title">Bonka Editor</h1>
      <p class="hub-copy">Open a Project Format v1 directory or create a new project to begin building scenes and metatiles.</p>
      <div class="hub-actions">
        <button class="action" type="button" :disabled="busy" @click="openProject">Open project</button>
        <button class="action primary" type="button" :disabled="busy" @click="createProject">New project</button>
      </div>
      <aside class="hub-permissions" aria-labelledby="permissions-title">
        <h2 id="permissions-title">Project folder access</h2>
        <p>Bonka will ask your browser for read and write access to a folder you choose. It can access only that folder and its subfolders.</p>
        <p>Choose a dedicated Bonka project folder. Do not select your home folder or a folder containing unrelated files.</p>
        <p class="hub-permissions-links"><a href="https://bonka.dev/docs/online-editor" target="_blank" rel="noreferrer">Using the online editor</a><a href="https://bonka.dev/privacy" target="_blank" rel="noreferrer">Privacy and project access</a></p>
      </aside>
      <p class="hub-status" role="status" aria-live="polite">{{ status }}</p>
    </section>
  </main>

  <main v-else class="editor-shell">
    <EditorHeader :project-name="editorState?.projectName ?? ''" :dirty="dirty" :busy="busy" :saving="saving" :show-saved="showSaved" @save="saveProject" @close="closeProject" @commands="commandsOpen = true" />

    <div class="editor-layout">
      <aside class="left-stack" aria-label="Project resources">
        <EditorPanel title="Project" class="project-panel">
          <label class="field field-stack" for="project-name">
            <span>Project name</span>
            <PillEditor id="project-name" :model-value="editorState?.projectName ?? ''" aria-label="Project name" @change="renameProject" />
          </label>
          <dl class="project-metrics">
            <div class="project-metric"><dt>Tilesets</dt><dd>{{ tilesets.length }}</dd></div>
            <div class="project-metric"><dt>Metatiles</dt><dd>{{ editorState?.metatiles.length ?? 0 }}</dd></div>
          </dl>
          <dl class="scene-metrics">
            <div class="scene-metric"><dt>Map size</dt><dd>{{ editorState?.scene.width ?? 0 }}x{{ editorState?.scene.height ?? 0 }} tiles</dd></div>
            <div class="scene-metric"><dt>Tile size</dt><dd>{{ editorState?.scene.tileWidth ?? 0 }}x{{ editorState?.scene.tileHeight ?? 0 }} px</dd></div>
            <div class="scene-metric"><dt>Grid size</dt><dd>{{ editorState?.scene.gridWidth ?? 0 }}x{{ editorState?.scene.gridHeight ?? 0 }} px</dd></div>
          </dl>
        </EditorPanel>
        <MetatilePanel :metatiles="editorState?.metatiles ?? []" :tilesets="tilesets" :selected-metatile-id="selectedMetatileId" :selected-tile="selectedTile" :mode="metatileMode" :busy="busy" @add="addNewMetatile" @select="selectMetatile" @activate-cell="activateMetatileCell" @update:mode="metatileMode = $event" @error="setCanvasError" />
        <TilesetPanel :tilesets="tilesets" :selected-tile="selectedTile" :busy="busy" @import="importTilesets" @select-tile="selectTile" @error="setCanvasError" />
      </aside>

      <SceneCanvas ref="sceneCanvas" :state="editorState" :show-grid="showGrid" :show-footprints="showFootprints" :active-layer-id="activeLayerId" :selected-metatile-id="selectedMetatileId" :flip-x="flipX" :flip-y="flipY" :can-undo="canUndo" :can-redo="canRedo" :active-tool="activeTool" :selection="selection" :brush-spacing="brushSpacing" @error="setCanvasError" @zoom-change="canvasZoom = $event" @paint="paintMetatile" @action="canvasAction" @stroke-start="beginStroke" @stroke-end="endStroke" @update:active-tool="setTool" @undo="undo" @redo="redo" />

      <aside class="right-stack" aria-label="Layers and properties">
        <EditorPanel title="Outliner">
          <LayerList :layers="editorState?.layers ?? []" :active-layer-id="activeLayerId" @select="activeLayerId = $event" @toggle-visibility="toggleLayerVisibility" @move="moveLayerToTarget" />
          <div class="layer-actions">
            <button class="action primary" type="button" @click="addLayer('tile')">Add tile layer</button>
            <button class="action" type="button" @click="addLayer('object')">Add object layer</button>
            <button class="action" type="button" @click="addLayer('group')">Add group</button>
            <button class="action danger" type="button" :disabled="!activeLayer" @click="deleteActiveLayer">Delete</button>
          </div>
        </EditorPanel>
        <ViewPanel v-model:show-grid="showGrid" v-model:show-footprints="showFootprints" v-model:flip-x="flipX" v-model:flip-y="flipY" v-model:brush-spacing="brushSpacing" :can-clear="Boolean(activeLayer && activeLayer.type !== 'group')" @clear="clearActiveLayer" />
        <EditorPanel title="Entities">
          <label class="field field-stack" for="entity-definition"><span>Definition</span><PillEditor id="entity-definition" :model-value="selectedEntityDefinitionId" aria-label="Entity definition" :options="entityDefinitions.length ? entityDefinitions.map(definition => ({ label: definition.name, value: definition.id })) : [{ label: 'No definitions', value: '' }]" :disabled="!entityDefinitions.length" @change="selectedEntityDefinitionId = String($event)" /></label>
          <button class="action" type="button" @click="addGenericEntityDefinition">Add generic definition</button>
        </EditorPanel>
        <LayerPropertiesPanel :layer="activeLayer" @patch="patchActiveLayer" />
        <HistoryPanel :entries="historyEntries" :current-index="historyIndex" @go-to="goToHistory" />
        <SelectionPanel :selection="selectedItem" @patch="patchSelection" @remove="deleteSelection" />
      </aside>
    </div>

    <StatusBar :message="status" :zoom="canvasZoom" @zoom-out="sceneCanvas?.zoomOut()" @set-zoom="sceneCanvas?.setZoom($event)" @zoom-in="sceneCanvas?.zoomIn()" @reset-view="sceneCanvas?.resetView()" @fit-view="sceneCanvas?.fitView()" />
    <CommandsModal v-model:open="commandsOpen" />
  </main>
</template>
