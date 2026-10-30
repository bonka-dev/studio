<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";

import {
  closeBrowserProject,
  createBrowserProject,
  importPngTilesets,
  importPngSprites,
  openBrowserProject,
  saveBrowserProject,
  removeSprite,
  removeTileset,
} from "./lib/io/browser-project-loader.mjs";
import { addEntityDefinition, addEntityInstance, addMetatile, addPrefab, applyEditorState, projectToEditorState, removeEntityInstance, toResourceId } from "./lib/project/editor-project.mjs";
import { createGroup, createObjectLayer, createTileLayer, getLayerParent, moveLayer, removeLayer, traverseLayers } from "./lib/workspace/editor-commands.mjs";
import { useProjectHistory } from "./composables/use-project-history";
import { flattenSpriteAuthoring } from "./lib/sprites/flatten-authoring.mjs";
import { cellFromPixel, flattenObjectLayers, flattenTileLayers, removePlacement, upsertPlacement } from "./lib/canvas/scene-renderer.mjs";

type DirectoryPicker = (options: { mode: "readwrite" }) => Promise<any>;

const project = shallowRef<any>(null);
const editorState = shallowRef<any>(null);
const busy = shallowRef(false);
const saving = shallowRef(false);
const dirty = shallowRef(false);
const showSaved = ref(false);
const commandsOpen = ref(false);
const confirmation = ref<{ title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void } | null>(null);
const activeLayerId = ref<string | null>(null);
const canvasZoom = ref(1);
const sceneCanvas = ref<any>(null);
const spriteAssetCanvas = ref<any>(null);
const spriteAssetZoom = ref(1);
const status = shallowRef("Choose a project directory to continue.");
const tilesets = computed(() => editorState.value?.tilesets ?? []);
const selectedTile = ref<{ tileset: string; startTile: number; columns: number; rows: number } | null>(null);
const selectedMetatileId = ref<string | null>(null);
const selectedPrefabId = ref<string | null>(null);
const metatileMode = ref<"tiles" | "collision">("tiles");
const showGrid = ref(true);
const showFootprints = ref(false);
const flipX = ref(false);
const flipY = ref(false);
const brushSpacing = ref(1);
const activeTool = ref("tile");
const workspaceMode = ref<"map" | "entities" | "tiles" | "sprite" | "sprites">("map");
const selection = ref<{ kind: "object" | "entity"; id: string; layerId?: string } | null>(null);
const selectedEntityDefinitionId = ref("");
const selectedSpriteId = ref("");
const entityVersion = ref(0);
const spriteVersion = ref(0);
let stroke: { erase: boolean; changed: boolean } | null = null;
let savedTimer: ReturnType<typeof setTimeout> | null = null;
const projectHistory = useProjectHistory(historySnapshot, restoreHistoryState);
const historyEntries = projectHistory.entries;
const historyIndex = projectHistory.index;
const canUndo = projectHistory.canUndo;
const canRedo = projectHistory.canRedo;
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
const sprites = computed(() => {
  spriteVersion.value;
  return [...(project.value?.sprites?.values() ?? [])];
});
const selectedEntityDefinition = computed(() => {
  entityVersion.value;
  return project.value?.entities?.get(selectedEntityDefinitionId.value) ?? null;
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
  selectedPrefabId.value = editorState.value.prefabs[0]?.id ?? null;
  selectedEntityDefinitionId.value = nextProject.entities.keys().next().value ?? "";
  selectedSpriteId.value = [...nextProject.sprites.keys()][0] ?? "";
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
  requestConfirmation({
    title: "Clear layer?",
    message: `Clear all content from '${layer.name}'?`,
    confirmLabel: "Clear layer",
    danger: true,
    action: () => {
      commit(updateLayer(layer.id, item => ({ ...item, placements: [], objects: [] })), `Clear ${layer.name}`);
      status.value = `Cleared ${layer.name}. Save to write files.`;
    },
  });
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
  if(!layer) return;
  requestConfirmation({
    title: "Delete layer?",
    message: `Delete '${layer.name}' and all of its contents?`,
    confirmLabel: "Delete layer",
    danger: true,
    action: () => {
      const nextState = removeLayer(editorState.value, layer.id);
      commit(nextState, `Delete ${layer.name}`);
      activeLayerId.value = findFirstTileLayer(nextState.layers) ?? nextState.layers.at(-1)?.id ?? null;
      status.value = `Deleted ${layer.name}. Save to write files.`;
    },
  });
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
  projectHistory.reset(state);
  dirty.value = false;
}

function commit(state: any, label: string) {
  if(savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  showSaved.value = false;
  projectHistory.commit(state, label);
  dirty.value = projectHistory.isDirty();
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
  projectHistory.goTo(index);
  dirty.value = projectHistory.isDirty();
  if(!findLayer(editorState.value.layers, activeLayerId.value ?? "")) {
    activeLayerId.value = findFirstTileLayer(editorState.value.layers);
  }
}

function historySnapshot(state: any) {
  const entityResourcePaths = [...(project.value?.resourcePaths ?? new Map()).entries()]
    .filter(([key]) => key.startsWith("entity:"));
  const inputMapResourcePaths = [...(project.value?.resourcePaths ?? new Map()).entries()]
    .filter(([key]) => key.startsWith("inputMap:"));
  return {
    ...state,
    __spriteDocuments: [...(project.value?.sprites ?? new Map()).entries()],
    __entityDocuments: [...(project.value?.entities ?? new Map()).entries()],
    __entityResourcePaths: entityResourcePaths,
    __manifestEntityResources: [...(project.value?.manifest.resources.entities ?? [])],
    __inputMapResourcePaths: inputMapResourcePaths,
    __manifestInputMapResources: [...(project.value?.manifest.resources.inputMaps ?? [])],
  };
}

function restoreHistoryState(snapshot: any) {
  const { __spriteDocuments, __entityDocuments, __entityResourcePaths, __manifestEntityResources, __inputMapResourcePaths, __manifestInputMapResources, ...state } = snapshot;
  editorState.value = state;
  if(__spriteDocuments && project.value) {
    project.value.sprites = new Map(__spriteDocuments);
    spriteVersion.value++;
  }
  if(__entityDocuments && project.value) {
    project.value.entities = new Map(__entityDocuments);
    for(const key of [...project.value.resourcePaths.keys()]) {
      if(key.startsWith("entity:")) project.value.resourcePaths.delete(key);
    }
    for(const [key, path] of __entityResourcePaths ?? []) project.value.resourcePaths.set(key, path);
    project.value.manifest.resources.entities = [...(__manifestEntityResources ?? [])];
    if(!project.value.entities.has(selectedEntityDefinitionId.value)) {
      selectedEntityDefinitionId.value = project.value.entities.keys().next().value ?? "";
    }
    entityVersion.value++;
  }
  if(project.value) {
    project.value.inputMaps = new Map((state.inputMaps ?? []).map((inputMap: any) => [inputMap.id, structuredClone(inputMap)]));
    for(const key of [...project.value.resourcePaths.keys()]) {
      if(key.startsWith("inputMap:")) project.value.resourcePaths.delete(key);
    }
    for(const [key, path] of __inputMapResourcePaths ?? []) project.value.resourcePaths.set(key, path);
    project.value.manifest.resources.inputMaps = [...(__manifestInputMapResources ?? [])];
    if(state.selectedInputMapId) project.value.manifest.inputMap = state.selectedInputMapId;
    else delete project.value.manifest.inputMap;
  }
}

function commitSpriteHistory(action: { id: string; authoring: any; label: string }) {
  const sprite = project.value?.sprites.get(action.id);
  if(!sprite) return;
  project.value.sprites.set(action.id, { ...sprite, authoring: action.authoring });
  spriteVersion.value++;
  commit(editorState.value, action.label);
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
    if(event.key === "Delete" && workspaceMode.value === "map" && selection.value) {
      event.preventDefault();
      deleteSelection();
      return;
    }
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
  const prefab = editorState.value.prefabs.find((item: any) => item.id === selectedPrefabId.value);
  if(prefab) {
    const placements = prefab.placements.filter((placement: any) => {
      const metatile = editorState.value.metatiles.find((item: any) => item.id === placement.metatile);
      return metatile && metatile.columns * metatile.tileWidth === editorState.value.scene.tileWidth && metatile.rows * metatile.tileHeight === editorState.value.scene.tileHeight;
    });
    if(!placements.length) {
      status.value = "The selected prefab has no compatible metatiles.";
      return;
    }
    applyStrokeChange(updateLayer(layer.id, item => placements.reduce((next: any, placement: any) => {
      const targetX = x + placement.cell.x;
      const targetY = y + placement.cell.y;
      if(targetX < 0 || targetY < 0 || targetX >= editorState.value.scene.width || targetY >= editorState.value.scene.height) return next;
      return upsertPlacement(next, { metatileId: placement.metatile, x: targetX, y: targetY, flipX: false, flipY: false, sourceHasFlip: false });
    }, item)), `Stamp ${prefab.name}`);
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

function ensureEntityDefinition(id: string, name: string) {
  const existing = project.value.entities.get(id);
  if(existing) return existing;
  applyEditorState(project.value, editorState.value);
  const definition = addEntityDefinition(project.value, { id, name });
  selectedEntityDefinitionId.value = definition.id;
  entityVersion.value++;
  return definition;
}

function commitEntityDefinition(definition: any, label: string) {
  project.value.entities.set(definition.id, definition);
  entityVersion.value++;
  commit(editorState.value, label);
  status.value = `Updated ${definition.name}. Save to write files.`;
}

function updateEntityName(value: string | number) {
  const definition = selectedEntityDefinition.value;
  const name = String(value).trim();
  if(!definition || !name || name === definition.name) return;
  commitEntityDefinition({ ...structuredClone(definition), name }, `Rename ${definition.name} definition`);
}

async function importSprites(files: File[]) {
  if(!files.length) return;
  busy.value = true;
  try {
    applyEditorState(project.value, editorState.value);
    const imported = await importPngSprites(project.value, files);
    selectedSpriteId.value = imported[0]?.id ?? selectedSpriteId.value;
    spriteVersion.value++;
    commit(editorState.value, `Import ${imported.length} sprite${imported.length === 1 ? "" : "s"}`);
    status.value = `Imported ${imported.length} sprite${imported.length === 1 ? "" : "s"}. Save to write files.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not import the selected PNG files.";
  } finally {
    busy.value = false;
  }
}

function updateSprite(sprite: any) {
  project.value.sprites.set(sprite.id, sprite);
  spriteVersion.value++;
  dirty.value = true;
  status.value = `Updated ${sprite.id}. Save to write files.`;
}

function renameSprite(id: string, name: string) {
  const sprite = project.value?.sprites.get(id);
  if(!sprite) return;
  updateSprite({ ...sprite, name });
}

async function createBlankSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if(!blob) return;
  await importSprites([new File([blob], "sprite.png", { type: "image/png" })]);
  const sprite = project.value.sprites.get(selectedSpriteId.value);
  if(sprite) updateSprite({ ...sprite, authoring: { version: 1, width: 16, height: 16, layers: [{ id: "drawing-1", name: "Drawing", visible: true, kind: "drawing", pixels: Array(256).fill(null) }] } });
}

async function prepareSpriteOutputs() {
  project.value.pendingBinaryWrites ??= new Map();
  for(const [id, sprite] of project.value.sprites) {
    if(!sprite.authoring) continue;
    const key = `sprite:${id}`;
    const sourcePath = project.value.sourcePaths.get(key);
    if(!sourcePath) continue;
    const bytes = await flattenSpriteAuthoring(sprite.authoring);
    project.value.pendingBinaryWrites.set(sourcePath, bytes);
    project.value.sourceBytes?.set(key, bytes);
    const previousUrl = project.value.sourceUrls?.get(key);
    if(previousUrl) URL.revokeObjectURL(previousUrl);
    project.value.sourceUrls?.set(key, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
  }
}

function removeSpriteAnimation({ spriteId, animationId }: { spriteId: string; animationId: string }) {
  const references = [...project.value.entities.values()].filter((entity: any) =>
    entity.components.sprite?.asset === spriteId && entity.components.sprite.animation === animationId
  );
  const directionalReferences = (project.value.sprites.get(spriteId)?.directionalSets ?? [])
    .filter((set: any) => set.variants.some((variant: any) => variant.animation === animationId))
    .map((set: any) => set.id);
  if(references.length || directionalReferences.length) {
    const usedBy = [...references.map((entity: any) => entity.name), ...directionalReferences.map((id: string) => `directional set '${id}'`)];
    status.value = `Cannot delete '${animationId}': used by ${usedBy.join(", ")}.`;
    return;
  }
  const sprite = project.value.sprites.get(spriteId);
  if(!sprite || Object.keys(sprite.animations).length === 1) return;
  requestConfirmation({
    title: "Delete animation?",
    message: `Delete animation '${animationId}' from '${spriteId}'?`,
    confirmLabel: "Delete animation",
    danger: true,
    action: () => {
      const next = structuredClone(sprite);
      delete next.animations[animationId];
      updateSprite(next);
      status.value = `Deleted ${animationId} from ${spriteId}. Save to write files.`;
    },
  });
}

function renameSpriteAnimation({ spriteId, from, to }: { spriteId: string; from: string; to: string }) {
  const sprite = project.value.sprites.get(spriteId);
  if(!sprite || sprite.animations[to]) return;
  const next = structuredClone(sprite);
  next.animations = Object.fromEntries(Object.entries(next.animations).map(([id, animation]) => [id === from ? to : id, animation]));
  for(const set of next.directionalSets ?? []) {
    for(const variant of set.variants) {
      if(variant.animation === from) variant.animation = to;
    }
  }
  project.value.sprites.set(spriteId, next);
  for(const [entityId, entity] of project.value.entities) {
    if(entity.components.sprite?.asset !== spriteId || entity.components.sprite.animation !== from) continue;
    const updated = structuredClone(entity);
    updated.components.sprite.animation = to;
    project.value.entities.set(entityId, updated);
  }
  entityVersion.value++;
  updateSprite(next);
  status.value = `Renamed ${from} to ${to}. Save to write files.`;
}

function removeSpriteDirectionalSet({ spriteId, setId }: { spriteId: string; setId: string }) {
  const references = [...project.value.entities.values()].filter((entity: any) =>
    entity.components.sprite?.asset === spriteId && entity.components.sprite.directionalSet === setId
  );
  if(references.length) {
    status.value = `Cannot delete '${setId}': used by ${references.map((entity: any) => entity.name).join(", ")}.`;
    return;
  }
  const sprite = project.value.sprites.get(spriteId);
  if(!sprite) return;
  const next = structuredClone(sprite);
  next.directionalSets = next.directionalSets.filter((set: any) => set.id !== setId);
  updateSprite(next);
}

function renameSpriteDirectionalSet({ spriteId, from, to }: { spriteId: string; from: string; to: string }) {
  const sprite = project.value.sprites.get(spriteId);
  if(!sprite || sprite.directionalSets?.some((set: any) => set.id === to)) return;
  const next = structuredClone(sprite);
  const set = next.directionalSets?.find((item: any) => item.id === from);
  if(!set) return;
  set.id = to;
  for(const [entityId, entity] of project.value.entities) {
    if(entity.components.sprite?.asset !== spriteId || entity.components.sprite.directionalSet !== from) continue;
    const updated = structuredClone(entity);
    updated.components.sprite.directionalSet = to;
    project.value.entities.set(entityId, updated);
  }
  entityVersion.value++;
  updateSprite(next);
}

function removeProjectSprite(id: string) {
  const references = [...project.value.entities.values()].filter((entity: any) => entity.components.sprite?.asset === id);
  if(references.length) {
    const names = references.map((entity: any) => entity.name).join(", ");
    status.value = `Cannot delete '${id}': used by ${names}.`;
    requestConfirmation({
      title: "Sprite is in use",
      message: `Cannot delete sprite '${id}'. It is assigned to: ${names}. Remove or replace it in the Map Editor first.`,
      confirmLabel: "Close",
      action: () => {},
    });
    return;
  }
  requestConfirmation({
    title: "Delete sprite?",
    message: `Delete sprite '${id}' and its source PNG?`,
    confirmLabel: "Delete sprite",
    danger: true,
    action: () => {
      try {
        removeSprite(project.value, id);
        selectedSpriteId.value = [...project.value.sprites.keys()][0] ?? "";
        spriteVersion.value++;
        commit(editorState.value, `Delete ${id} sprite`);
        status.value = `Deleted ${id}. Save to remove its files.`;
      } catch(error: any) {
        status.value = error?.message ?? `Could not delete ${id}.`;
      }
    },
  });
}

function updateEntitySprite(value: string | number) {
  const definition = project.value.entities.get(selectedEntityDefinitionId.value);
  if(!definition) return;
  const spriteId = String(value);
  const next = structuredClone(definition);
  if(!spriteId) {
    delete next.components.sprite;
  } else {
    const sprite = project.value.sprites.get(spriteId);
    next.components.sprite = { asset: spriteId, animation: Object.keys(sprite.animations)[0] };
  }
  commitEntityDefinition(next, `Edit ${next.name} sprite`);
}

function updateEntityAnimation(value: string | number) {
  const definition = project.value.entities.get(selectedEntityDefinitionId.value);
  if(!definition?.components.sprite) return;
  const next = structuredClone(definition);
  next.components.sprite.animation = String(value);
  delete next.components.sprite.directionalSet;
  commitEntityDefinition(next, `Edit ${next.name} animation`);
}

function updateEntityDirectionalSet(value: string | number) {
  const definition = project.value.entities.get(selectedEntityDefinitionId.value);
  if(!definition?.components.sprite) return;
  const next = structuredClone(definition);
  const directionalSet = String(value);
  if(!directionalSet) return;
  next.components.sprite.directionalSet = directionalSet;
  delete next.components.sprite.animation;
  commitEntityDefinition(next, `Edit ${next.name} directional set`);
}

function updateEntitySpriteMode(value: string | number) {
  const definition = project.value.entities.get(selectedEntityDefinitionId.value);
  const component = definition?.components.sprite;
  if(!component) return;
  const sprite = project.value.sprites.get(component.asset);
  const mode = String(value);
  if(mode === "directional" && !sprite.directionalSets?.length) {
    status.value = `Create a directional set on '${sprite.id}' before selecting this mode.`;
    return;
  }
  const next = structuredClone(definition);
  if(mode === "directional") {
    next.components.sprite = { asset: component.asset, directionalSet: sprite.directionalSets[0].id };
  } else {
    next.components.sprite = { asset: component.asset, animation: Object.keys(sprite.animations)[0] };
  }
  commitEntityDefinition(next, `Edit ${next.name} animation mode`);
}

function updateEntityBehavior(value: string | number) {
  const definition = selectedEntityDefinition.value;
  if(!definition) return;
  const entered = String(value).trim();
  const next = structuredClone(definition);
  if(!entered) {
    if(!next.components.behavior) return;
    delete next.components.behavior;
    if(!Object.keys(next.components).length) next.components.collider = { shape: "box", width: 1, height: 1 };
  } else {
    const id = toResourceId(entered, "");
    if(!id) {
      status.value = "Behavior ID must contain letters or digits.";
      return;
    }
    next.components.behavior = { ...next.components.behavior, id };
  }
  commitEntityDefinition(next, `Edit ${next.name} behavior`);
}

function updateEntityInputActions(value: string | number) {
  const definition = selectedEntityDefinition.value;
  if(!definition?.components.behavior) return;
  const actions = [...new Set(String(value).split(",")
    .map(action => toResourceId(action.trim(), ""))
    .filter(Boolean))];
  const next = structuredClone(definition);
  if(actions.length) next.components.behavior.inputActions = actions;
  else delete next.components.behavior.inputActions;
  commitEntityDefinition(next, `Edit ${next.name} input actions`);
}

const directionalMovementActions = [
  { id: "move-up", control: "up" },
  { id: "move-down", control: "down" },
  { id: "move-left", control: "left" },
  { id: "move-right", control: "right" },
];

function addDirectionalMovement() {
  const definition = selectedEntityDefinition.value;
  if(!definition) return;
  const sprite = sprites.value.find((item: any) => item.id === definition.components.sprite?.asset);
  const directionalSet = sprite?.directionalSets?.[0]?.id;
  if(!sprite || !directionalSet) {
    status.value = "Select a sprite asset with a directional set before adding directional movement.";
    return;
  }
  const next = structuredClone(definition);
  next.components.sprite = { asset: sprite.id, directionalSet };
  next.components.behavior = {
    id: "directional-movement",
    inputActions: ["move-up", "move-down", "move-left", "move-right"],
    parameters: {
      movementSpace: "screen",
      speed: 1,
      normalizeDiagonal: true,
      idleAsset: sprite.id,
      idleSet: directionalSet,
      movingAsset: sprite.id,
      movingSet: directionalSet,
    },
  };

  const inputMaps = structuredClone(editorState.value.inputMaps);
  let selectedInputMapId = editorState.value.selectedInputMapId;
  let inputMap = inputMaps.find((item: any) => item.id === selectedInputMapId);
  if(!inputMap) {
    const usedIds = new Set(inputMaps.map((item: any) => item.id));
    selectedInputMapId = "default";
    for(let index = 1; usedIds.has(selectedInputMapId); ++index) selectedInputMapId = `input-map-${index}`;
    inputMap = { formatVersion: 1, type: "inputMap", id: selectedInputMapId, name: "Default", actions: [] };
    inputMaps.push(inputMap);
    const path = `input-maps/${selectedInputMapId}.input-map.json`;
    project.value.resourcePaths.set(`inputMap:${selectedInputMapId}`, path);
    project.value.manifest.resources.inputMaps ??= [];
    project.value.manifest.resources.inputMaps.push(path);
  }
  const existingActions = new Set(inputMap.actions.map((action: any) => action.id));
  const missingActions = directionalMovementActions.filter(action => !existingActions.has(action.id));
  if(inputMap.actions.length + missingActions.length > 32) {
    status.value = `Input map '${inputMap.id}' has no room for the four directional movement actions.`;
    return;
  }
  for(const action of missingActions) {
    inputMap.actions.push({
      id: action.id,
      bindings: [{ platform: "gba", control: action.control, trigger: "held" }],
    });
  }

  project.value.entities.set(next.id, next);
  entityVersion.value++;
  commit({ ...editorState.value, inputMaps, selectedInputMapId }, `Add directional movement to ${next.name}`);
  status.value = `Added directional movement to ${next.name}. Save to write files.`;
}

function updateDirectionalMovement(patch: Record<string, string | number | boolean>) {
  const definition = selectedEntityDefinition.value;
  if(definition?.components.behavior?.id !== "directional-movement") return;
  const next = structuredClone(definition);
  next.components.behavior.parameters = { ...next.components.behavior.parameters, ...patch };
  commitEntityDefinition(next, `Edit ${next.name} directional movement`);
}

function addInputMap() {
  const usedIds = new Set(editorState.value.inputMaps.map((inputMap: any) => inputMap.id));
  let index = 1;
  while(usedIds.has(`input-map-${index}`)) index++;
  const id = `input-map-${index}`;
  const inputMap = { formatVersion: 1, type: "inputMap", id, name: `Input Map ${index}`, actions: [] };
  const path = `input-maps/${id}.input-map.json`;
  project.value.resourcePaths.set(`inputMap:${id}`, path);
  project.value.manifest.resources.inputMaps ??= [];
  project.value.manifest.resources.inputMaps.push(path);
  commit({ ...editorState.value, inputMaps: [...editorState.value.inputMaps, inputMap], selectedInputMapId: id }, `Add ${inputMap.name}`);
}

function selectInputMap(id: string) {
  if(!editorState.value.inputMaps.some((inputMap: any) => inputMap.id === id)) return;
  commit({ ...editorState.value, selectedInputMapId: id }, "Select input map");
}

function updateInputMap(inputMap: any, label: string) {
  const previous = editorState.value.inputMaps.find((item: any) => item.id === inputMap.id);
  if(previous) {
    const nextActionIds = new Set(inputMap.actions.map((action: any) => action.id));
    const removedActionIds = previous.actions
      .map((action: any) => action.id)
      .filter((id: string) => !nextActionIds.has(id));
    const subscribedActionIds = new Set([...project.value.entities.values()]
      .flatMap((definition: any) => definition.components.behavior?.inputActions ?? []));
    const referencedAction = removedActionIds.find((id: string) => subscribedActionIds.has(id));
    if(referencedAction) {
      status.value = `Input action '${referencedAction}' is subscribed by an entity definition. Update that definition before renaming or removing the action.`;
      return;
    }
  }
  commit({
    ...editorState.value,
    inputMaps: editorState.value.inputMaps.map((item: any) => item.id === inputMap.id ? inputMap : item),
  }, label);
}

function updateEntityCollider(patch: { width?: number; height?: number }) {
  const definition = selectedEntityDefinition.value;
  if(!definition) return;
  const collider = { shape: "box", width: 1, height: 1, ...definition.components.collider, ...patch };
  collider.width = Math.max(1, Math.round(Number(collider.width) || 1));
  collider.height = Math.max(1, Math.round(Number(collider.height) || 1));
  const next = structuredClone(definition);
  next.components.collider = collider;
  commitEntityDefinition(next, `Edit ${next.name} collider`);
}

function editEntityDefinition(id: string) {
  if(!project.value.entities.has(id)) return;
  selectedEntityDefinitionId.value = id;
  workspaceMode.value = "entities";
}

function selectSceneEntity(id: string) {
  if(!editorState.value.entities.some((entity: any) => entity.id === id)) return;
  selection.value = { kind: "entity", id };
}

function openSceneEntity(id: string) {
  selectSceneEntity(id);
  workspaceMode.value = "map";
}

function placeEntityAt(point: { x: number; y: number }, preset: "player" | "enemy" | null = null) {
  const cell = cellFromPixel(editorState.value, null, point.x, point.y);
  if(!cell) return;
  const definition = preset ? ensureEntityDefinition(preset, preset === "player" ? "Player" : "Enemy") : project.value.entities.get(selectedEntityDefinitionId.value);
  if(!definition) {
    status.value = "Select or create a placement definition before placing an entity.";
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
  const visibilityNotice = definition.components.sprite ? "" : ` Assign a sprite asset to ${definition.name} to make it visible in a GBA build.`;
  const instance = addEntityInstance(next, { definition: definition.id, ...cell });
  selection.value = { kind: "entity", id: instance.id };
  commit(next, `Add ${definition.name} entity`);
  if(visibilityNotice) status.value = `Added ${definition.name} entity.${visibilityNotice}`;
}

function patchSelection(patch: Record<string, unknown>) {
  const item = selectedItem.value;
  if(!item) return;
  if(selection.value?.kind === "entity" && "definition" in patch && !project.value.entities.has(String(patch.definition))) {
    status.value = `Unknown entity definition '${patch.definition}'.`;
    return;
  }
  if(("x" in patch && (!Number.isInteger(patch.x) || Number(patch.x) < 0 || Number(patch.x) >= editorState.value.scene.width)) || ("y" in patch && (!Number.isInteger(patch.y) || Number(patch.y) < 0 || Number(patch.y) >= editorState.value.scene.height))) {
    status.value = "Selection coordinates must be cells inside the scene.";
    return;
  }
  const instanceId = String(patch.id ?? item.id);
  if(selection.value?.kind === "entity" && "id" in patch) {
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(instanceId)) {
      status.value = "Instance ID must use lowercase letters, digits and hyphens.";
      return;
    }
    if(editorState.value.entities.some((candidate: any) => candidate.id === instanceId && candidate.id !== item.id)) {
      status.value = `Entity instance ID '${instanceId}' is already in use.`;
      return;
    }
  }
  const next = structuredClone(editorState.value);
  if(selection.value?.kind === "entity") {
    const index = next.entities.findIndex((candidate: any) => candidate.id === item.id);
    next.entities[index] = { ...next.entities[index], ...patch, ...("definition" in patch ? { kind: String(patch.definition) } : {}) };
    if("id" in patch) selection.value = { ...selection.value, id: instanceId };
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
    if(imported[0]) selectedTile.value = { tileset: imported[0].id, startTile: 0, columns: 1, rows: 1 };
    status.value = `Imported ${imported.length} PNG tileset${imported.length === 1 ? "" : "s"}. Save to write files.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not import the selected PNG files.";
  } finally {
    busy.value = false;
  }
}

function selectTile(selection: { tileset: string; startTile: number; columns: number; rows: number }) {
  selectedTile.value = selection;
  const tileset = tilesets.value.find(item => item.id === selection.tileset);
  status.value = `Selected ${tileset?.name ?? selection.tileset}, ${selection.columns}x${selection.rows} tiles.`;
}

function selectTileset(id: string) {
  const tileset = tilesets.value.find(item => item.id === id);
  if(!tileset) return;
  selectTile({ tileset: id, startTile: 0, columns: 1, rows: 1 });
}

function renameTileset(id: string, name: string) {
  const tileset = tilesets.value.find(item => item.id === id);
  if(!tileset || !name || name === tileset.name) return;
  commit({
    ...editorState.value,
    tilesets: editorState.value.tilesets.map(item => item.id === id ? { ...item, name } : item),
  }, `Rename ${tileset.name} tileset`);
}

function removeProjectTileset(id: string) {
  const references = editorState.value.metatiles.filter(metatile => metatile.data.some((tile: any) => tile?.tileset === id));
  if(references.length) {
    const names = references.map(metatile => metatile.name).join(", ");
    status.value = `Cannot delete '${id}': used by ${names}.`;
    requestConfirmation({
      title: "Tileset is in use",
      message: `Cannot delete tileset '${id}'. It is used by: ${names}. Remove or replace those metatile tiles first.`,
      confirmLabel: "Close",
      action: () => {},
    });
    return;
  }
  requestConfirmation({
    title: "Delete tileset?",
    message: `Delete tileset '${id}' and its source PNG?`,
    confirmLabel: "Delete tileset",
    danger: true,
    action: () => {
      try {
        applyEditorState(project.value, editorState.value);
        removeTileset(project.value, id);
        const nextTilesets = editorState.value.tilesets.filter(item => item.id !== id);
        commit({
          ...editorState.value,
          tilesets: nextTilesets,
          scene: { ...editorState.value.scene, tilesetIds: editorState.value.scene.tilesetIds.filter((tilesetId: string) => tilesetId !== id) },
        }, `Delete ${id} tileset`);
        selectedTile.value = nextTilesets[0] ? { tileset: nextTilesets[0].id, startTile: 0, columns: 1, rows: 1 } : null;
        status.value = `Deleted ${id}. Save to remove its files.`;
      } catch(error: any) {
        status.value = error?.message ?? `Could not delete ${id}.`;
      }
    },
  });
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

function addNewPrefab(options: { name: string; columns: number; rows: number }) {
  try {
    applyEditorState(project.value, editorState.value);
    const prefab = addPrefab(project.value, options);
    commit({ ...editorState.value, prefabs: [...editorState.value.prefabs, { ...prefab, placements: [] }] }, `Add ${prefab.name}`);
    selectedPrefabId.value = prefab.id;
    selectedMetatileId.value = null;
    status.value = `Added ${prefab.name}. Select a metatile, then click its cells to compose it.`;
  } catch(error: any) {
    status.value = error?.message ?? "Could not add the prefab.";
  }
}

function selectPrefab(id: string) {
  selectedPrefabId.value = id;
  selectedMetatileId.value = null;
}

function activatePrefabCell({ index, clear }: { index: number; clear: boolean }) {
  const prefab = editorState.value.prefabs.find(item => item.id === selectedPrefabId.value);
  if(!prefab) return;
  if(!clear && !selectedMetatileId.value) {
    status.value = "Select a metatile before placing it in a prefab.";
    return;
  }
  const x = index % prefab.columns;
  const y = Math.floor(index / prefab.columns);
  const placements = prefab.placements.filter((placement: any) => placement.cell.x !== x || placement.cell.y !== y);
  if(!clear) placements.push({ metatile: selectedMetatileId.value, cell: { x, y } });
  commit({ ...editorState.value, prefabs: editorState.value.prefabs.map(item => item.id === prefab.id ? { ...item, placements } : item) }, clear ? `Clear ${prefab.name} cell` : `Edit ${prefab.name}`);
}

function selectMetatile(id: string) {
  selectedMetatileId.value = id;
}

function selectMapMetatile(id: string) {
  selectedMetatileId.value = id;
  selectedPrefabId.value = null;
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
    const targetX = index % item.columns;
    const targetY = Math.floor(index / item.columns);
    for(let y = 0; y < selectedTile.value.rows; ++y) for(let x = 0; x < selectedTile.value.columns; ++x) {
      const destinationX = targetX + x;
      const destinationY = targetY + y;
      if(destinationX >= item.columns || destinationY >= item.rows) continue;
      const sourceTile = selectedTile.value.startTile + y * tileset.columns + x;
      if(sourceTile >= tileset.tileCount) continue;
      data[destinationY * item.columns + destinationX] = { tileset: selectedTile.value.tileset, tile: sourceTile };
    }
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
    await prepareSpriteOutputs();
    await saveBrowserProject(project.value);
    projectHistory.markSaved();
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
  if(dirty.value) {
    requestConfirmation({
      title: "Discard unsaved changes?",
      message: "Close this project without saving your changes?",
      confirmLabel: "Discard changes",
      danger: true,
      action: closeProjectNow,
    });
    return;
  }
  closeProjectNow();
}

function closeProjectNow() {
  closeBrowserProject(project.value);
  project.value = null;
  editorState.value = null;
  selectedTile.value = null;
  selectedMetatileId.value = null;
  selectedPrefabId.value = null;
  selectedSpriteId.value = "";
  dirty.value = false;
  showSaved.value = false;
  if(savedTimer) clearTimeout(savedTimer);
  savedTimer = null;
  projectHistory.clear();
  status.value = "Choose a project directory to continue.";
}

function requestConfirmation(request: { title: string; message: string; confirmLabel: string; danger?: boolean; action: () => void }) {
  confirmation.value = request;
}

function confirmAction() {
  const action = confirmation.value?.action;
  confirmation.value = null;
  action?.();
}
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout v-if="!project" name="default" :busy="busy" :status="status" @open="openProject" @create="createProject" />

  <NuxtLayout v-else name="editor" :project-name="editorState?.projectName ?? ''" :dirty="dirty" :busy="busy" :saving="saving" :show-saved="showSaved" :workspace-mode="workspaceMode" @update:workspace-mode="workspaceMode = $event" @save="saveProject" @close="closeProject" @commands="commandsOpen = true">
    <template #workspace>

    <WorkspaceMap v-if="workspaceMode === 'map'" ref="sceneCanvas" :state="editorState" :tilesets="tilesets" :busy="busy" :selected-tile="selectedTile" :selected-metatile-id="selectedMetatileId" :selected-prefab-id="selectedPrefabId" :metatile-mode="metatileMode" :show-grid="showGrid" :show-footprints="showFootprints" :active-layer-id="activeLayerId" :flip-x="flipX" :flip-y="flipY" :can-undo="canUndo" :can-redo="canRedo" :active-tool="activeTool" :selection="selection" :brush-spacing="brushSpacing" :entity-definitions="entityDefinitions" :selected-entity-definition-id="selectedEntityDefinitionId" :active-layer="activeLayer" :selected-item="selectedItem" :history-entries="historyEntries" :history-index="historyIndex" @rename-project="renameProject" @select-prefab="selectPrefab" @select-map-metatile="selectMapMetatile" @error="setCanvasError" @zoom-change="canvasZoom = $event" @paint="paintMetatile" @action="canvasAction" @stroke-start="beginStroke" @stroke-end="endStroke" @update:active-tool="setTool" @undo="undo" @redo="redo" @update:active-layer-id="activeLayerId = $event" @toggle-layer-visibility="toggleLayerVisibility" @move-layer="moveLayerToTarget" @add-layer="addLayer" @delete-active-layer="deleteActiveLayer" @select-scene-entity="selectSceneEntity" @edit-entity-definition="editEntityDefinition" @update:show-grid="showGrid = $event" @update:show-footprints="showFootprints = $event" @update:flip-x="flipX = $event" @update:flip-y="flipY = $event" @update:brush-spacing="brushSpacing = $event" @clear-active-layer="clearActiveLayer" @update:selected-entity-definition-id="selectedEntityDefinitionId = $event" @create-entity-definition="addGenericEntityDefinition" @patch-active-layer="patchActiveLayer" @go-to-history="goToHistory" @patch-selection="patchSelection" @delete-selection="deleteSelection" />

    <WorkspaceEntities v-else-if="workspaceMode === 'entities'" :definitions="entityDefinitions" :selected-id="selectedEntityDefinitionId" :sprites="sprites" :source-urls="project.sourceUrls" :instances="editorState?.entities ?? []" :input-maps="editorState?.inputMaps ?? []" :selected-input-map-id="editorState?.selectedInputMapId ?? ''" :history-entries="historyEntries" :history-index="historyIndex" @create="addGenericEntityDefinition" @select="selectedEntityDefinitionId = $event" @update-name="updateEntityName" @update-sprite="updateEntitySprite" @update-sprite-mode="updateEntitySpriteMode" @update-animation="updateEntityAnimation" @update-directional-set="updateEntityDirectionalSet" @update-behavior="updateEntityBehavior" @update-input-actions="updateEntityInputActions" @add-directional-movement="addDirectionalMovement" @update-directional-movement="updateDirectionalMovement" @update-collider="updateEntityCollider" @add-input-map="addInputMap" @select-input-map="selectInputMap" @update-input-map="updateInputMap" @open-instance="openSceneEntity" @go-to-history="goToHistory" />

    <WorkspaceTiles v-else-if="workspaceMode === 'tiles'" :state="editorState" :tilesets="tilesets" :selected-tile="selectedTile" :selected-metatile-id="selectedMetatileId" :selected-prefab-id="selectedPrefabId" :metatile-mode="metatileMode" :busy="busy" @add-metatile="addNewMetatile" @select-metatile="selectMetatile" @activate-metatile-cell="activateMetatileCell" @update:metatile-mode="metatileMode = $event" @error="setCanvasError" @import-tilesets="importTilesets" @select-tileset="selectTileset" @rename-tileset="renameTileset" @remove-tileset="removeProjectTileset" @select-tile="selectTile" @add-prefab="addNewPrefab" @select-prefab="selectPrefab" @activate-prefab-cell="activatePrefabCell" />
    <WorkspaceAnimation v-else-if="workspaceMode === 'sprite'" :sprites="sprites" :selected-id="selectedSpriteId" :source-urls="project.sourceUrls" :busy="busy" @import="importSprites" @create="createBlankSprite" @select="selectedSpriteId = $event" @update="updateSprite" @rename="renameSprite" @rename-animation="renameSpriteAnimation" @remove-animation="removeSpriteAnimation" @rename-directional-set="renameSpriteDirectionalSet" @remove-directional-set="removeSpriteDirectionalSet" @remove-sprite="removeProjectSprite" />
    <WorkspaceSpriteAsset v-else ref="spriteAssetCanvas" :sprites="sprites" :selected-id="selectedSpriteId" :source-urls="project.sourceUrls" :busy="busy" :zoom="spriteAssetZoom" :can-undo="canUndo" :can-redo="canRedo" :history-entries="historyEntries" :history-index="historyIndex" @zoom-change="spriteAssetZoom = $event" @undo="undo" @redo="redo" @history="commitSpriteHistory" @go-to-history="goToHistory" @import="importSprites" @create-blank="createBlankSprite" @remove="removeProjectSprite" @rename="renameSprite" @select="selectedSpriteId = $event" @update="updateSprite" />

    </template>
    <template #status><StatusBar :message="status" :zoom="workspaceMode === 'sprites' ? spriteAssetZoom : canvasZoom" :max-zoom="workspaceMode === 'sprites' ? 32 : 4" @zoom-out="workspaceMode === 'sprites' ? spriteAssetCanvas?.zoomOut() : sceneCanvas?.zoomOut()" @set-zoom="workspaceMode === 'sprites' ? spriteAssetCanvas?.setZoom($event) : sceneCanvas?.setZoom($event)" @zoom-in="workspaceMode === 'sprites' ? spriteAssetCanvas?.zoomIn() : sceneCanvas?.zoomIn()" @reset-view="workspaceMode === 'sprites' ? spriteAssetCanvas?.resetView() : sceneCanvas?.resetView()" @fit-view="workspaceMode === 'sprites' ? spriteAssetCanvas?.fitView() : sceneCanvas?.fitView()" /></template>
    <template #overlays><CommandsModal v-model:open="commandsOpen" /><ConfirmationModal :open="Boolean(confirmation)" :title="confirmation?.title ?? ''" :message="confirmation?.message ?? ''" :confirm-label="confirmation?.confirmLabel" :danger="confirmation?.danger" @update:open="open => { if(!open) confirmation = null; }" @confirm="confirmAction" /></template>
  </NuxtLayout>
</template>
