import {
    addEntityDefinition,
    addEntityInstance,
    addMetatile,
    applyEditorState,
    closeBrowserProject,
    createBrowserProject,
    importPngTilesets,
    openBrowserProject,
    projectToEditorState,
    removeEntityInstance,
    saveBrowserProject,
} from "./main.mjs";
import {
    cellFromPixel,
    createSceneRenderer,
    flattenTileLayers,
    removePlacement,
    scenePixelSize,
    upsertPlacement,
} from "./canvas/scene-renderer.mjs";
import { interpolateIsoBrushCells, nearestIsoBrushCell, snapBrushCell } from "./canvas/iso-brush.mjs";
import {
    createGroup,
    createHistory,
    createObjectLayer,
    createTileLayer,
    findLayer,
    getLayerParent,
    moveLayer,
    removeLayer,
    traverseLayers,
} from "./workspace/editor-commands.mjs";

const byId = id => document.getElementById(id);
const elements = Object.fromEntries([
    "projectHub", "hubStatus", "openProject", "newProject", "editorShell", "projectTitle",
    "projectNameInput", "tilesetCount", "metatileCount", "mapSizeValue", "tileSizeValue", "gridSizeValue", "saveProject", "closeProject",
    "commandsButton", "commandsDialog", "commandsCloseButton", "outlinerBadge", "metatileNameInput", "metatileColumnsInput", "metatileRowsInput",
    "metatileModeButton", "addMetatileButton", "metatileEditor", "metatileList", "tileSearch",
    "tilesetImportButton", "tilesetFileInput", "tilePalette", "undoButton", "redoButton",
    "canvasWrap", "canvasStage", "mapCanvas",
    "layerList", "addTileLayerButton", "addObjectLayerButton", "addGroupButton", "deleteLayerButton", "gridToggle", "footprintToggle",
    "tileFlipXInput", "tileFlipYInput", "brushSpacingInput", "clearActiveLayerButton", "inspectorLayerId", "inspectorLayerName",
    "inspectorLayerVisible", "inspectorLayerOpacity", "inspectorLayerOpacityValue",
    "inspectorLayerHOffset", "inspectorLayerZOffset", "historyList", "cursorCell",
    "cursorPixel", "zoomOutButton", "zoomRange", "zoomInButton", "resetViewButton",
    "fitViewButton", "status",
    "entityDefinitionSelect", "addEntityDefinitionButton", "selectionType", "selectionId",
    "selectionName", "selectionVisible", "selectionX", "selectionY", "deleteSelectionButton",
].map(id => [id, byId(id)]));

const renderer = createSceneRenderer(elements.mapCanvas);
const imageCache = new Map();
let project = null;
let state = null;
let history = null;
let resourceDirty = false;
let selectedTile = null;
let selectedMetatileId = null;
let activeLayerId = null;
let selection = null;
let metatileMode = "tiles";
let tool = "tile";
let zoom = 1;
let pan = { x: 0, y: 0 };
let gesture = null;

function initializePanelTitles() {
    for(const title of document.querySelectorAll(".panel-title")) {
        title.addEventListener("click", () => {
            const panel = title.closest(".panel");
            const collapsed = panel.classList.toggle("collapsed");
            title.setAttribute("aria-expanded", String(!collapsed));
            title.title = collapsed ? "Expand panel" : "Collapse panel";
        });
    }
}

function pillLabel(control) {
    if(control instanceof HTMLSelectElement) return control.selectedOptions[0]?.textContent || "Select";
    return control.value || control.placeholder || "Set value";
}

function initializePillEditors() {
    const controls = [...document.querySelectorAll("input[type=text], input[type=number], select")]
        .filter(control => !control.readOnly && !control.matches("#tileSearch"));
    for(const control of controls) {
        const wrapper = document.createElement("span");
        wrapper.className = "pill-editor";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pill-edit-button";
        button.addEventListener("click", () => {
            wrapper.classList.add("editing");
            control.focus();
            if(control instanceof HTMLInputElement) control.select();
        });
        control.classList.add("pill-edit-control");
        control.before(wrapper);
        wrapper.append(button, control);
        const finish = () => {
            button.textContent = pillLabel(control);
            wrapper.classList.remove("editing");
        };
        control.addEventListener("change", finish);
        control.addEventListener("blur", finish);
        control.addEventListener("keydown", event => {
            if(event.key === "Enter") { event.preventDefault(); control.blur(); }
            if(event.key === "Escape") { event.preventDefault(); control.blur(); }
        });
        finish();
    }
}

function refreshPillEditors() {
    for(const wrapper of document.querySelectorAll(".pill-editor")) {
        const control = wrapper.querySelector(".pill-edit-control");
        if(!wrapper.classList.contains("editing")) wrapper.querySelector(".pill-edit-button").textContent = pillLabel(control);
    }
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function setStatus(message, error = false, hub = false) {
    const target = hub ? elements.hubStatus : elements.status;
    target.textContent = message;
    target.classList.toggle("error", error);
}

function isDirty() {
    return Boolean(history?.isDirty() || resourceDirty);
}

function confirmDiscard() {
    return !isDirty() || globalThis.confirm("Discard unsaved project changes?");
}

function selectedMetatile() {
    return state?.metatiles.find(item => item.id === selectedMetatileId) ?? null;
}

function activeLayer() {
    return state ? findLayer(state.layers, activeLayerId) : null;
}

function tileLayer() {
    const layer = activeLayer();
    return layer?.type === "tile" ? layer : null;
}

function selectedTileset() {
    return state?.tilesets.find(item => item.id === selectedTile?.tileset) ?? null;
}

function selectedItem() {
    if(!selection || !state) return null;
    if(selection.kind === "entity") {
        return state.entities.find(item => item.id === selection.id) ?? null;
    }
    const layer = findLayer(state.layers, selection.layerId);
    return layer?.objects?.find(item => item.id === selection.id) ?? null;
}

function setRendererState() {
    if(! state) return;
    const hover = tool === "tile" && selectedMetatileId ? {
        metatileId: selectedMetatileId,
        layerId: activeLayerId,
        flipX: elements.tileFlipXInput.checked,
        flipY: elements.tileFlipYInput.checked,
    } : null;
    renderer.setOptions({
        showGrid: elements.gridToggle.checked,
        showFootprints: elements.footprintToggle.checked,
        hover,
        snapHover: true,
        selectedObjectId: selection?.kind === "object" ? selection.id : null,
        selectedEntityId: selection?.kind === "entity" ? selection.id : null,
    }).catch(error => setStatus(`Renderer: ${errorMessage(error)}`, true));
    renderer.setState(state).catch(error => setStatus(`Renderer: ${errorMessage(error)}`, true));
    const size = scenePixelSize(state);
    elements.canvasStage.style.width = `${size.width}px`;
    elements.canvasStage.style.height = `${size.height}px`;
    elements.mapCanvas.style.width = `${size.width}px`;
    elements.mapCanvas.style.height = `${size.height}px`;
}

function applyView() {
    elements.canvasStage.style.left = "0";
    elements.canvasStage.style.top = "0";
    elements.canvasStage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    elements.zoomRange.value = String(Math.round(zoom * 100));
}

function centerView(nextZoom = zoom) {
    if(! state) return;
    const size = scenePixelSize(state);
    zoom = Math.min(4, Math.max(.25, nextZoom));
    pan = {
        x: (elements.canvasWrap.clientWidth - size.width * zoom) / 2,
        y: (elements.canvasWrap.clientHeight - size.height * zoom) / 2,
    };
    applyView();
}

function fitView() {
    if(! state) return;
    const size = scenePixelSize(state);
    const fitted = Math.min(
        elements.canvasWrap.clientWidth / size.width,
        elements.canvasWrap.clientHeight / size.height
    );
    centerView(fitted);
}

function updateLayer(layers, id, transform) {
    return layers.map(layer => {
        if(layer.id === id) return transform(layer);
        if(layer.type === "group") return { ...layer, layers: updateLayer(layer.layers, id, transform) };
        return layer;
    });
}

function commit(nextState, label) {
    state = history.push(nextState, label);
    render();
}

function establishResourceBaseline(label) {
    state = history.reset(state, label);
    resourceDirty = true;
    render();
}

function imageFor(tileset, onReady) {
    const cached = imageCache.get(tileset.id);
    if(cached?.url === tileset.image) {
        if(onReady && !cached.image.complete) cached.image.addEventListener("load", onReady, { once: true });
        return cached.image;
    }
    const image = new Image();
    if(onReady) image.addEventListener("load", onReady, { once: true });
    image.onerror = () => setStatus(`Unable to load tileset image '${tileset.image}'`, true);
    image.src = tileset.image;
    imageCache.set(tileset.id, { url: tileset.image, image });
    return image;
}

function drawSourceTile(canvas, reference) {
    const tileset = state.tilesets.find(item => item.id === reference?.tileset);
    if(! tileset) return;
    canvas.width = tileset.tileWidth;
    canvas.height = tileset.tileHeight;
    const draw = () => {
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, canvas.width, canvas.height);
        const margin = tileset.margin ?? 0;
        const spacing = tileset.spacing ?? 0;
        context.drawImage(
            image,
            margin + (reference.tile % tileset.columns) * (tileset.tileWidth + spacing),
            margin + Math.floor(reference.tile / tileset.columns) * (tileset.tileHeight + spacing),
            tileset.tileWidth,
            tileset.tileHeight,
            0,
            0,
            tileset.tileWidth,
            tileset.tileHeight
        );
    };
    const image = imageFor(tileset, draw);
    if(image.complete && image.naturalWidth) draw();
}

function drawMetatilePreview(canvas, metatile) {
    canvas.width = metatile.columns * metatile.tileWidth;
    canvas.height = metatile.rows * metatile.tileHeight;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    metatile.data.forEach((reference, index) => {
        if(! reference) return;
        const tileCanvas = document.createElement("canvas");
        drawSourceTile(tileCanvas, reference);
        const redraw = () => {
            drawSourceTile(tileCanvas, reference);
            context.drawImage(
                tileCanvas,
                (index % metatile.columns) * metatile.tileWidth,
                Math.floor(index / metatile.columns) * metatile.tileHeight,
                metatile.tileWidth,
                metatile.tileHeight
            );
        };
        redraw();
        const tileset = state.tilesets.find(item => item.id === reference.tileset);
        if(tileset) imageFor(tileset, redraw);
    });
}

function renderTilePalette() {
    elements.tilePalette.replaceChildren();
    const query = elements.tileSearch.value.trim().toLowerCase();
    let shown = 0;
    for(const [tilesetIndex, tileset] of state.tilesets.entries()) {
        const matchingTiles = Array.from({ length: tileset.tileCount }, (_, tile) => tile)
            .filter(tile => !query || tileset.name.toLowerCase().includes(query) || tileset.id.toLowerCase().includes(query) || `tile ${tile}`.includes(query));
        if(!matchingTiles.length) continue;
        shown++;
        const group = document.createElement("details");
        group.className = "tile-group";
        group.open = Boolean(query) || selectedTile?.tileset === tileset.id || (tilesetIndex === 0 && state.tilesets.length < 8);
        const heading = document.createElement("summary");
        heading.textContent = `${tileset.name} (${matchingTiles.length})`;
        group.append(heading);
        const tiles = document.createElement("div");
        tiles.className = "tile-group-grid";
        tiles.style.setProperty("--tileset-columns", String(tileset.columns));
        group.append(tiles);
        const populate = () => {
            if(tiles.childElementCount) return;
            for(const tile of matchingTiles) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "preview-button tile-preview";
                button.title = `${tileset.name} / tile ${tile}`;
                button.setAttribute("aria-label", button.title);
                button.classList.toggle("selected", selectedTile?.tileset === tileset.id && selectedTile.tile === tile);
                const canvas = document.createElement("canvas");
                canvas.className = "preview-canvas";
                drawSourceTile(canvas, { tileset: tileset.id, tile });
                button.append(canvas);
                button.addEventListener("click", () => {
                    selectedTile = { tileset: tileset.id, tile };
                    renderTilePalette();
                    setStatus(`Selected ${tileset.name}, tile ${tile}.`);
                });
                tiles.append(button);
            }
        };
        if(group.open) populate();
        group.addEventListener("toggle", () => {
            if(group.open) populate();
        });
        elements.tilePalette.append(group);
    }
    if(!shown) {
        const empty = document.createElement("p");
        empty.className = "empty-note";
        empty.textContent = state.tilesets.length ? "No tiles match the search." : "Import a PNG tileset to fill the palette.";
        elements.tilePalette.append(empty);
    }
}

function editMetatileCell(index, clear = false) {
    const metatile = selectedMetatile();
    if(!metatile) return;
    if(metatileMode === "collision") {
        const next = structuredClone(state);
        const target = next.metatiles.find(item => item.id === metatile.id);
        target.collisionMap[index] = target.collisionMap[index] ? 0 : 1;
        commit(next, `Edit ${metatile.name} collision`);
        return;
    }
    if(!clear && !selectedTile) return;
    const tileset = selectedTileset();
    if(!clear && (tileset.tileWidth !== metatile.tileWidth || tileset.tileHeight !== metatile.tileHeight)) {
        setStatus("Selected tile dimensions do not match this metatile.", true);
        return;
    }
    const next = structuredClone(state);
    next.metatiles.find(item => item.id === metatile.id).data[index] = clear ? null : { ...selectedTile };
    commit(next, `${clear ? "Clear" : "Paint"} ${metatile.name} cell`);
}

function renderMetatileEditor() {
    const metatile = selectedMetatile();
    elements.metatileEditor.replaceChildren();
    elements.metatileNameInput.disabled = !metatile;
    elements.metatileModeButton.textContent = metatileMode === "tiles" ? "Mode: tiles" : "Mode: collision";
    elements.metatileModeButton.setAttribute("aria-pressed", String(metatileMode === "collision"));
    if(!metatile) {
        elements.metatileNameInput.value = "";
        const empty = document.createElement("p");
        empty.textContent = "Add or select a metatile to edit it.";
        elements.metatileEditor.append(empty);
        return;
    }
    elements.metatileNameInput.value = metatile.name;
    elements.metatileEditor.style.gridTemplateColumns = `repeat(${metatile.columns}, minmax(0, 1fr))`;
    metatile.data.forEach((reference, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "metatile-cell";
        button.title = reference ? `${reference.tileset} / tile ${reference.tile}` : "Empty cell";
        if(reference) {
            const canvas = document.createElement("canvas");
            canvas.className = "preview-canvas";
            drawSourceTile(canvas, reference);
            button.append(canvas);
        }
        if(metatile.collisionMap[index]) {
            const collision = document.createElement("span");
            collision.className = "collision-overlay";
            collision.textContent = "C";
            button.append(collision);
        }
        button.addEventListener("click", () => editMetatileCell(index));
        button.addEventListener("contextmenu", event => {
            event.preventDefault();
            editMetatileCell(index, true);
        });
        elements.metatileEditor.append(button);
    });
}

function renderMetatileList() {
    elements.metatileList.replaceChildren();
    for(const metatile of state.metatiles) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "resource-button";
        button.classList.toggle("selected", metatile.id === selectedMetatileId);
        const canvas = document.createElement("canvas");
        canvas.className = "metatile-preview-canvas";
        drawMetatilePreview(canvas, metatile);
        const label = document.createElement("span");
        label.textContent = metatile.name;
        button.append(canvas, label);
        button.addEventListener("click", () => {
            selectedMetatileId = metatile.id;
            setTool("tile");
            render();
        });
        elements.metatileList.append(button);
    }
}

function renderLayers() {
    elements.layerList.replaceChildren();
    function appendLayers(layers, depth) {
        for(const layer of [...layers].reverse()) {
            const row = document.createElement("div");
            row.className = "layer-row";
            row.classList.toggle("active", layer.id === activeLayerId);
            row.classList.toggle("group-row", layer.type === "group");
            row.style.setProperty("--layer-depth", depth);
            row.draggable = true;
            row.addEventListener("dragstart", event => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", layer.id);
            });
            row.addEventListener("dragover", event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                row.classList.add("drop-target");
            });
            row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
            row.addEventListener("drop", event => {
                event.preventDefault();
                event.stopPropagation();
                row.classList.remove("drop-target");
                const movingId = event.dataTransfer.getData("text/plain");
                if(!movingId || movingId === layer.id) return;
                if(layer.type === "group") {
                    commit(moveLayer(state, movingId, layer.id, layer.layers.length), `Move layer into ${layer.name}`);
                } else {
                    const parent = getLayerParent(state.layers, layer.id);
                    const siblings = parent?.layers ?? state.layers;
                    commit(moveLayer(state, movingId, parent?.id ?? null, siblings.findIndex(item => item.id === layer.id)), `Move layer before ${layer.name}`);
                }
            });
            const select = document.createElement("button");
            select.type = "button";
            select.className = "layer-select";
            const name = document.createElement("strong");
            name.textContent = layer.name;
            const meta = document.createElement("span");
            const kind = layer.type === "group" ? "Group" : layer.type === "object" ? "Object" : "Tile";
            meta.textContent = layer.type === "group" ? `${kind} · ${layer.layers.length} layer${layer.layers.length === 1 ? "" : "s"}` :
                `${kind} · ${layer.placements.length} tile${layer.placements.length === 1 ? "" : "s"} · ${layer.objects.length} object${layer.objects.length === 1 ? "" : "s"}`;
            select.append(name, meta);
            select.addEventListener("click", () => {
                activeLayerId = layer.id;
                render();
            });
            const visibility = document.createElement("button");
            visibility.type = "button";
            visibility.className = "visibility-button layer-icon";
            visibility.innerHTML = layer.visible === false
                ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 3 18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.8M6.5 6.5C3.5 8.4 2 12 2 12s3.5 6 10 6a10 10 0 0 0 3.5-.6"/></svg>'
                : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
            visibility.title = layer.visible === false ? "Show layer" : "Hide layer";
            visibility.addEventListener("click", () => commit({
                ...state,
                layers: updateLayer(state.layers, layer.id, item => ({ ...item, visible: item.visible === false })),
            }, `${layer.visible === false ? "Show" : "Hide"} ${layer.name}`));
            const type = document.createElement("span");
            type.className = "layer-type-icon";
            type.title = `${kind} layer`;
            type.innerHTML = layer.type === "group"
                ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5z"/></svg>'
                : layer.type === "object"
                    ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7.752.066a.5.5 0 0 1 .496 0l3.75 2.143a.5.5 0 0 1 .252.434v3.995l3.498 2A.5.5 0 0 1 16 9.07v4.286a.5.5 0 0 1-.252.434l-3.75 2.143a.5.5 0 0 1-.496 0l-3.502-2-3.502 2.001a.5.5 0 0 1-.496 0l-3.75-2.143A.5.5 0 0 1 0 13.357V9.071a.5.5 0 0 1 .252-.434L3.75 6.638V2.643a.5.5 0 0 1 .252-.434zM4.25 7.504 1.508 9.071l2.742 1.567 2.742-1.567zM7.5 9.933l-2.75 1.571v3.134l2.75-1.571zm1 3.134 2.75 1.571v-3.134L8.5 9.933zm.508-3.996 2.742 1.567 2.742-1.567-2.742-1.567zm2.242-2.433V3.504L8.5 5.076V8.21zM7.5 8.21V5.076L4.75 3.504v3.134zM5.258 2.643 8 4.21l2.742-1.567L8 1.076zM15 9.933l-2.75 1.571v3.134L15 13.067zM3.75 14.638v-3.134L1 9.933v3.134z"/></svg>'
                    : '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h13A1.5 1.5 0 0 1 16 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5zM1.5 1a.5.5 0 0 0-.5.5V5h4V1zM5 6H1v4h4zm1 4h4V6H6zm-1 1H1v3.5a.5.5 0 0 0 .5.5H5zm1 0v4h4v-4zm5 0v4h3.5a.5.5 0 0 0 .5-.5V11zm0-1h4V6h-4zm0-5h4V1.5a.5.5 0 0 0-.5-.5H11zm-1 0V1H6v4z"/></svg>';
            row.append(visibility, type, select);
            elements.layerList.append(row);
            if(layer.type === "group") appendLayers(layer.layers, depth + 1);
        }
    }
    appendLayers(state.layers, 0);
}

function renderInspector() {
    const layer = activeLayer();
    const controls = [
        elements.inspectorLayerName, elements.inspectorLayerVisible, elements.inspectorLayerOpacity,
        elements.inspectorLayerHOffset, elements.inspectorLayerZOffset,
    ];
    for(const control of controls) control.disabled = !layer;
    elements.deleteLayerButton.disabled = !layer;
    elements.inspectorLayerId.value = layer?.id ?? "";
    elements.inspectorLayerName.value = layer?.name ?? "";
    elements.inspectorLayerVisible.checked = layer?.visible !== false;
    elements.inspectorLayerOpacity.value = String(layer?.opacity ?? 1);
    elements.inspectorLayerOpacityValue.value = `${Math.round((layer?.opacity ?? 1) * 100)}%`;
    elements.inspectorLayerHOffset.value = String(layer?.hOffset ?? 0);
    elements.inspectorLayerZOffset.value = String(layer?.zOffset ?? 0);
}

function renderEntityDefinitions() {
    const selected = elements.entityDefinitionSelect.value;
    elements.entityDefinitionSelect.replaceChildren();
    for(const definition of project.entities.values()) {
        elements.entityDefinitionSelect.add(new Option(definition.name, definition.id));
    }
    if([...elements.entityDefinitionSelect.options].some(option => option.value === selected)) {
        elements.entityDefinitionSelect.value = selected;
    }
}

function renderSelection() {
    const item = selectedItem();
    if(selection && !item) selection = null;
    elements.selectionType.textContent = selection?.kind === "entity" ? "Entity" : selection?.kind === "object" ? "Object" : "None";
    elements.selectionId.value = item?.id ?? "";
    elements.selectionName.value = item?.name ?? item?.id ?? "";
    elements.selectionVisible.checked = item?.visible !== false;
    elements.selectionX.value = item ? String(item.x) : "";
    elements.selectionY.value = item ? String(item.y) : "";
    elements.selectionName.disabled = !item || selection?.kind === "entity";
    elements.selectionVisible.disabled = !item || selection?.kind === "entity";
    elements.selectionX.disabled = !item;
    elements.selectionY.disabled = !item;
    elements.deleteSelectionButton.disabled = !item;
}

function renderHistory() {
    const entries = history.entries();
    const index = history.index();
    elements.historyList.replaceChildren();
    [...entries].reverse().forEach((entry, reverseIndex) => {
        const entryIndex = entries.length - 1 - reverseIndex;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "history-row";
        row.classList.toggle("current", entryIndex === index);
        row.classList.toggle("future", entryIndex > index);
        row.textContent = entry.label;
        row.addEventListener("click", () => {
            state = history.goTo(entryIndex);
            render();
        });
        elements.historyList.append(row);
    });
    elements.undoButton.disabled = index === 0;
    elements.redoButton.disabled = index === entries.length - 1;
    elements.saveProject.disabled = !isDirty();
    elements.outlinerBadge.textContent = isDirty() ? "edited" : "saved";
    document.title = `${isDirty() ? "* " : ""}${state.projectName || "Untitled project"} • Bonka`;
}

function render() {
    if(!state) return;
    if(!findLayer(state.layers, activeLayerId)) {
        activeLayerId = traverseLayers(state.layers).find(layer => layer.type === "tile")?.id ?? null;
    }
    if(selectedMetatileId && !state.metatiles.some(item => item.id === selectedMetatileId)) selectedMetatileId = null;
    elements.projectTitle.textContent = state.projectName || "Untitled project";
    elements.projectNameInput.value = state.projectName;
    elements.tilesetCount.textContent = String(state.tilesets.length);
    elements.metatileCount.textContent = String(state.metatiles.length);
    elements.mapSizeValue.textContent = `${state.scene.width}×${state.scene.height} tiles`;
    elements.tileSizeValue.textContent = `${state.scene.tileWidth}×${state.scene.tileHeight} px`;
    elements.gridSizeValue.textContent = `${state.scene.gridWidth}×${state.scene.gridHeight} px`;
    renderTilePalette();
    renderMetatileEditor();
    renderMetatileList();
    renderLayers();
    renderInspector();
    renderEntityDefinitions();
    renderSelection();
    renderHistory();
    refreshPillEditors();
    setRendererState();
}

function adoptProject(nextProject, message) {
    if(project) closeBrowserProject(project);
    project = nextProject;
    state = projectToEditorState(project, project.sourceUrls);
    history = createHistory(state, "Open project");
    resourceDirty = false;
    selectedTile = null;
    selectedMetatileId = state.metatiles[0]?.id ?? null;
    activeLayerId = traverseLayers(state.layers).find(layer => layer.type === "tile")?.id ?? null;
    selection = null;
    imageCache.clear();
    elements.projectHub.hidden = true;
    elements.editorShell.hidden = false;
    render();
    setStatus(message);
    requestAnimationFrame(fitView);
}

function returnToHub() {
    renderer.setState(null).catch(() => {});
    closeBrowserProject(project);
    project = null;
    state = null;
    history = null;
    resourceDirty = false;
    selection = null;
    imageCache.clear();
    elements.editorShell.hidden = true;
    elements.projectHub.hidden = false;
    document.title = "Bonka Editor";
    setStatus("Choose a project directory to continue.", false, true);
}

async function chooseDirectory() {
    if(!globalThis.showDirectoryPicker) throw new Error("File System Access requires a Chromium-based browser.");
    return globalThis.showDirectoryPicker({ mode: "readwrite" });
}

async function openOrCreate(create) {
    if(project && !confirmDiscard()) return;
    try {
        const root = await chooseDirectory();
        if(create) {
            const prompted = globalThis.prompt("Project name", "Untitled Project");
            if(prompted === null) return;
            adoptProject(await createBrowserProject(root, { name: prompted.trim() || "Untitled Project" }), "Created Project Format v1 project.");
        } else {
            adoptProject(await openBrowserProject(root), "Opened Project Format v1 project.");
        }
    } catch(error) {
        if(error?.name !== "AbortError") setStatus(errorMessage(error), true, !project);
    }
}

elements.newProject.addEventListener("click", () => openOrCreate(true));
elements.openProject.addEventListener("click", () => openOrCreate(false));
elements.closeProject.addEventListener("click", () => {
    if(confirmDiscard()) returnToHub();
});
elements.commandsButton.addEventListener("click", () => elements.commandsDialog.showModal());
elements.commandsCloseButton.addEventListener("click", () => elements.commandsDialog.close());
elements.commandsDialog.addEventListener("click", event => {
    if(event.target === elements.commandsDialog) elements.commandsDialog.close();
});

elements.saveProject.addEventListener("click", async () => {
    try {
        applyEditorState(project, state);
        await saveBrowserProject(project);
        history.markSaved();
        resourceDirty = false;
        renderHistory();
        setStatus("Saved Project Format v1 project.");
    } catch(error) {
        setStatus(errorMessage(error), true);
    }
});

elements.projectNameInput.addEventListener("change", () => commit({
    ...state,
    projectName: elements.projectNameInput.value.trim() || "Untitled Project",
}, "Rename project"));

elements.tilesetImportButton.addEventListener("click", () => elements.tilesetFileInput.click());
elements.tilesetFileInput.addEventListener("change", async () => {
    const files = [...elements.tilesetFileInput.files];
    elements.tilesetFileInput.value = "";
    if(!files.length) return;
    try {
        applyEditorState(project, state);
        const imported = await importPngTilesets(project, files, { tileWidth: 8, tileHeight: 8 });
        const synchronized = projectToEditorState(project, project.sourceUrls);
        state = { ...synchronized, layers: state.layers, entities: state.entities, metatiles: state.metatiles, projectName: state.projectName };
        selectedTile = imported[0] ? { tileset: imported[0].id, tile: 0 } : selectedTile;
        establishResourceBaseline(`Import ${imported.length} tileset${imported.length === 1 ? "" : "s"}`);
        setStatus(`Imported ${imported.length} PNG tileset${imported.length === 1 ? "" : "s"}. Save to write files.`);
    } catch(error) {
        setStatus(errorMessage(error), true);
    }
});
elements.tileSearch.addEventListener("input", renderTilePalette);

elements.addMetatileButton.addEventListener("click", () => {
    try {
        applyEditorState(project, state);
        const columns = Number(elements.metatileColumnsInput.value);
        const rows = Number(elements.metatileRowsInput.value);
        const source = selectedTileset();
        const name = elements.metatileNameInput.value.trim() || "Metatile";
        const metatile = addMetatile(project, {
            name,
            columns,
            rows,
            tileSize: { width: source?.tileWidth ?? 8, height: source?.tileHeight ?? 8 },
            tiles: Array(columns * rows).fill(null),
        });
        state.metatiles.push({
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
        });
        selectedMetatileId = metatile.id;
        setTool("tile");
        establishResourceBaseline(`Add ${metatile.name}`);
        setStatus(`Created blank metatile '${metatile.id}'.`);
    } catch(error) {
        setStatus(errorMessage(error), true);
    }
});

elements.metatileModeButton.addEventListener("click", () => {
    metatileMode = metatileMode === "tiles" ? "collision" : "tiles";
    renderMetatileEditor();
});
elements.metatileNameInput.addEventListener("change", () => {
    const metatile = selectedMetatile();
    if(!metatile) return;
    const name = elements.metatileNameInput.value.trim() || metatile.id;
    const next = structuredClone(state);
    next.metatiles.find(item => item.id === metatile.id).name = name;
    commit(next, `Rename metatile to ${name}`);
});

elements.addTileLayerButton.addEventListener("click", () => {
    const next = createTileLayer(state);
    activeLayerId = traverseLayers(next.layers).at(-1).id;
    setTool("tile");
    commit(next, "Add tile layer");
});
elements.addObjectLayerButton.addEventListener("click", () => {
    const next = createObjectLayer(state);
    activeLayerId = traverseLayers(next.layers).at(-1).id;
    commit(next, "Add object layer");
});
elements.addGroupButton.addEventListener("click", () => {
    const next = createGroup(state);
    activeLayerId = traverseLayers(next.layers).at(-1).id;
    commit(next, "Add layer group");
});
elements.deleteLayerButton.addEventListener("click", () => {
    const layer = activeLayer();
    if(!layer) return;
    activeLayerId = null;
    commit(removeLayer(state, layer.id), `Delete ${layer.name}`);
});

function commitLayerProperty(property, value, label) {
    const layer = activeLayer();
    if(!layer) return;
    commit({ ...state, layers: updateLayer(state.layers, layer.id, item => ({ ...item, [property]: value })) }, label);
}
elements.inspectorLayerName.addEventListener("change", () => commitLayerProperty("name", elements.inspectorLayerName.value.trim() || "Layer", "Rename layer"));
elements.inspectorLayerVisible.addEventListener("change", () => commitLayerProperty("visible", elements.inspectorLayerVisible.checked, "Change layer visibility"));
elements.inspectorLayerOpacity.addEventListener("input", () => {
    elements.inspectorLayerOpacityValue.value = `${Math.round(Number(elements.inspectorLayerOpacity.value) * 100)}%`;
});
elements.inspectorLayerOpacity.addEventListener("change", () => commitLayerProperty("opacity", Number(elements.inspectorLayerOpacity.value), "Change layer opacity"));
elements.inspectorLayerHOffset.addEventListener("change", () => commitLayerProperty("hOffset", Number(elements.inspectorLayerHOffset.value), "Change horizontal offset"));
elements.inspectorLayerZOffset.addEventListener("change", () => commitLayerProperty("zOffset", Number(elements.inspectorLayerZOffset.value), "Change height offset"));

function ensureEntityDefinition(id, name) {
    const existing = project.entities.get(id);
    if(existing) return existing;
    applyEditorState(project, state);
    const definition = addEntityDefinition(project, { id, name });
    establishResourceBaseline(`Add ${name} definition`);
    elements.entityDefinitionSelect.value = definition.id;
    return definition;
}

elements.addEntityDefinitionButton.addEventListener("click", () => {
    const name = globalThis.prompt("Entity definition name", "Entity");
    if(name === null) return;
    try {
        const definition = addEntityDefinition(project, { id: name, name: name.trim() || "Entity" });
        establishResourceBaseline(`Add ${definition.name} definition`);
        elements.entityDefinitionSelect.value = definition.id;
        setStatus(`Created generic entity definition '${definition.id}'.`);
    } catch(error) {
        setStatus(errorMessage(error), true);
    }
});

function updateSelection(transform, label) {
    const item = selectedItem();
    if(!item) return;
    const next = structuredClone(state);
    if(selection.kind === "entity") {
        const index = next.entities.findIndex(candidate => candidate.id === item.id);
        next.entities[index] = transform(next.entities[index]);
    } else {
        next.layers = updateLayer(next.layers, selection.layerId, layer => ({
            ...layer,
            objects: layer.objects.map(candidate => candidate.id === item.id ? transform(candidate) : candidate),
        }));
    }
    commit(next, label);
}

elements.selectionName.addEventListener("change", () => updateSelection(
    item => ({ ...item, name: elements.selectionName.value.trim() || item.id }),
    "Rename object"
));
elements.selectionVisible.addEventListener("change", () => updateSelection(
    item => ({ ...item, visible: elements.selectionVisible.checked }),
    "Change object visibility"
));
for(const [input, property] of [[elements.selectionX, "x"], [elements.selectionY, "y"]]) {
    input.addEventListener("change", () => {
        const value = Number(input.value);
        if(!Number.isInteger(value) || value < 0 || value >= (property === "x" ? state.scene.width : state.scene.height)) {
            setStatus("Selection coordinates must be cells inside the scene.", true);
            renderSelection();
            return;
        }
        updateSelection(item => ({ ...item, [property]: value }), "Move selection");
    });
}
elements.deleteSelectionButton.addEventListener("click", () => {
    const item = selectedItem();
    if(!item) return;
    let next;
    if(selection.kind === "entity") {
        next = structuredClone(state);
        removeEntityInstance(next, item.id);
    } else {
        next = {
            ...state,
            layers: updateLayer(state.layers, selection.layerId, layer => ({
                ...layer,
                objects: layer.objects.filter(candidate => candidate.id !== item.id),
            })),
        };
    }
    selection = null;
    commit(next, `Delete ${item.id}`);
});

function setTool(nextTool) {
    if(nextTool === "object" && activeLayer()?.type !== "object") {
        const existing = traverseLayers(state.layers).find(layer => layer.type === "object");
        if(existing) {
            activeLayerId = existing.id;
        } else {
            const next = createObjectLayer(state);
            activeLayerId = traverseLayers(next.layers).at(-1).id;
            state = history.push(next, "Add object layer");
        }
    }
    tool = nextTool;
    for(const button of document.querySelectorAll("[data-tool]")) {
        const active = button.dataset.tool === tool;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    }
    setRendererState();
    renderLayers();
    renderInspector();
    renderHistory();
}
for(const button of document.querySelectorAll("[data-tool]")) button.addEventListener("click", () => setTool(button.dataset.tool));
for(const input of [elements.gridToggle, elements.footprintToggle, elements.tileFlipXInput, elements.tileFlipYInput]) {
    input.addEventListener("change", setRendererState);
}
elements.clearActiveLayerButton.addEventListener("click", () => {
    const layer = activeLayer();
    if(!layer || layer.type === "group") {
        setStatus("Select a tile or object layer to clear.", true);
        return;
    }
    if(!layer.placements.length && !layer.objects.length) return;
    if(!globalThis.confirm(`Clear all content from '${layer.name}'?`)) return;
    commit({
        ...state,
        layers: updateLayer(state.layers, layer.id, item => ({ ...item, placements: [], objects: [] })),
    }, `Clear ${layer.name}`);
});

function undo() {
    if(history.index() === 0) return;
    state = history.undo();
    render();
}
function redo() {
    if(history.index() === history.entries().length - 1) return;
    state = history.redo();
    render();
}
elements.undoButton.addEventListener("click", undo);
elements.redoButton.addEventListener("click", redo);

function canvasPoint(event) {
    const bounds = elements.mapCanvas.getBoundingClientRect();
    return {
        x: (event.clientX - bounds.left) * elements.mapCanvas.width / bounds.width,
        y: (event.clientY - bounds.top) * elements.mapCanvas.height / bounds.height,
    };
}

// Tile painting snaps to the metatile's visual center, matching the legacy editor.
function snappedPaintCell(event, layer) {
    const view = flattenTileLayers(state.layers).find(candidate => candidate.id === layer.id) ?? layer;
    return snapBrushCell(canvasPoint(event), view, state.scene);
}

function selectAt(event) {
    const point = canvasPoint(event);
    const layers = traverseLayers(state.layers).filter(layer => layer.type !== "group").reverse();
    for(const layer of layers) {
        const cell = cellFromPixel(state, layer, point.x, point.y);
        const object = cell && layer.objects?.find(item => item.x === cell.x && item.y === cell.y && item.visible !== false);
        if(object) {
            selection = { kind: "object", id: object.id, layerId: layer.id };
            activeLayerId = layer.id;
            render();
            return;
        }
    }
    const cell = cellFromPixel(state, null, point.x, point.y);
    const entity = cell && state.entities.find(item => item.x === cell.x && item.y === cell.y);
    selection = entity ? { kind: "entity", id: entity.id } : null;
    render();
}

function placeObjectAt(event) {
    const layer = activeLayer();
    if(layer?.type !== "object") {
        setStatus("Select or add an object layer before placing objects.", true);
        return;
    }
    const point = canvasPoint(event);
    const cell = cellFromPixel(state, layer, point.x, point.y);
    if(!cell) return;
    const next = structuredClone(state);
    let number = next.scene.nextObjectId++;
    const used = new Set(traverseLayers(next.layers).flatMap(item => item.objects?.map(object => object.id) ?? []));
    while(used.has(`object-${number}`)) number = next.scene.nextObjectId++;
    const object = {
        id: `object-${number}`,
        kind: "object",
        name: `Object ${number}`,
        visible: true,
        x: cell.x,
        y: cell.y,
    };
    next.layers = updateLayer(next.layers, layer.id, item => ({ ...item, objects: [...item.objects, object] }));
    selection = { kind: "object", id: object.id, layerId: layer.id };
    commit(next, `Add ${object.name}`);
}

function placeEntityAt(event, preset = null) {
    const point = canvasPoint(event);
    const cell = cellFromPixel(state, null, point.x, point.y);
    if(!cell) return;
    let definition;
    if(preset) {
        definition = ensureEntityDefinition(preset, preset === "player" ? "Player" : "Enemy");
    } else {
        definition = project.entities.get(elements.entityDefinitionSelect.value);
        if(!definition) {
            setStatus("Create or select an entity definition before placing an entity.", true);
            return;
        }
    }
    const next = structuredClone(state);
    if(preset === "player") {
        const existing = next.entities.find(item => item.definition === definition.id);
        if(existing) {
            existing.x = cell.x;
            existing.y = cell.y;
            selection = { kind: "entity", id: existing.id };
            commit(next, "Move Player entity");
            return;
        }
    }
    if(preset === "enemy") {
        const existing = next.entities.find(item => item.definition === definition.id && item.x === cell.x && item.y === cell.y);
        if(existing) {
            removeEntityInstance(next, existing.id);
            selection = null;
            commit(next, "Remove Enemy entity");
            return;
        }
    }
    const instance = addEntityInstance(next, { definition: definition.id, x: cell.x, y: cell.y });
    selection = { kind: "entity", id: instance.id };
    commit(next, `Add ${definition.name} entity`);
}

function eraseAt(event) {
    const point = canvasPoint(event);
    const globalCell = cellFromPixel(state, null, point.x, point.y);
    if(!globalCell) return false;
    const key = `${globalCell.x},${globalCell.y}`;
    if(gesture.lastCell === key) return false;
    gesture.lastCell = key;
    const next = structuredClone(state);
    let changed = false;
    for(const layer of traverseLayers(next.layers)) {
        if(layer.type === "group") continue;
        const cell = cellFromPixel(next, layer, point.x, point.y);
        if(!cell) continue;
        const objectCount = layer.objects.length;
        layer.objects = layer.objects.filter(item => item.x !== cell.x || item.y !== cell.y);
        changed ||= layer.objects.length !== objectCount;
    }
    const entityCount = next.entities.length;
    next.entities = next.entities.filter(item => item.x !== globalCell.x || item.y !== globalCell.y);
    changed ||= next.entities.length !== entityCount;
    const layer = tileLayer();
    if(layer) {
        const cell = cellFromPixel(next, layer, point.x, point.y);
        const target = findLayer(next.layers, layer.id);
        if(cell && target.placements.some(item => item.x === cell.x && item.y === cell.y)) {
            target.placements = removePlacement(target, cell.x, cell.y).placements;
            changed = true;
        }
    }
    if(changed) {
        state = next;
        selection = null;
        gesture.changed = true;
        setRendererState();
    }
    return changed;
}

function paintAt(event, erase) {
    const layer = tileLayer();
    if(!layer) return false;
    const view = flattenTileLayers(state.layers).find(candidate => candidate.id === layer.id) ?? layer;
    const point = canvasPoint(event);
    const spacing = Math.max(1, Math.min(8, Number(elements.brushSpacingInput.value) || 1));
    let target;
    if(!gesture.lastCell) {
        target = snapBrushCell(point, view, state.scene);
        if(!target) return false;
        gesture.anchorCell = { ...target };
    } else {
        target = nearestIsoBrushCell(point, gesture.anchorCell, view, state.scene, spacing);
        if(!target) return false;
    }
    if(gesture.lastCell?.x === target.x && gesture.lastCell?.y === target.y) return false;
    const cells = gesture.lastCell
        ? interpolateIsoBrushCells(gesture.lastCell, target, gesture.anchorCell, spacing)
        : [target];
    gesture.lastCell = target;
    for(const targetCell of cells) {
        if(targetCell.x < 0 || targetCell.y < 0 || targetCell.x >= state.scene.width || targetCell.y >= state.scene.height) continue;
        const current = findLayer(state.layers, layer.id);
        let updated;
        if(erase) {
            const existed = current.placements.some(item => item.x === targetCell.x && item.y === targetCell.y);
            if(!existed) continue;
            updated = removePlacement(current, targetCell.x, targetCell.y);
        } else {
            if(!selectedMetatileId) continue;
            updated = upsertPlacement(current, {
                metatileId: selectedMetatileId,
                x: targetCell.x,
                y: targetCell.y,
                flipX: elements.tileFlipXInput.checked,
                flipY: elements.tileFlipYInput.checked,
                sourceHasFlip: elements.tileFlipXInput.checked || elements.tileFlipYInput.checked,
            });
        }
        state = { ...state, layers: updateLayer(state.layers, layer.id, () => updated) };
        gesture.changed = true;
    }
    setRendererState();
    return gesture.changed;
}

function paintPrecondition(erase) {
    if(erase) return null;
    const layer = tileLayer();
    if(!layer) return "Select or add a tile layer before painting.";
    const effectiveLayer = flattenTileLayers(state.layers).find(candidate => candidate.id === layer.id);
    if(!effectiveLayer?.visible || !effectiveLayer.opacity) return "The active tile layer or one of its groups is hidden.";
    const metatile = selectedMetatile();
    if(!metatile) return "Select a metatile before painting.";
    if(!metatile.visible || !metatile.opacity) return "The selected metatile is hidden.";
    if(!metatile.data.some(Boolean)) return "Add graphic tiles to the selected metatile before painting it.";
    if(metatile.columns * metatile.tileWidth !== state.scene.tileWidth ||
        metatile.rows * metatile.tileHeight !== state.scene.tileHeight) {
        return `The selected metatile must render to ${state.scene.tileWidth}x${state.scene.tileHeight} pixels for this scene.`;
    }
    return null;
}

elements.canvasWrap.addEventListener("contextmenu", event => event.preventDefault());
elements.mapCanvas.addEventListener("pointerdown", event => {
    const panning = event.button === 1 || (event.button === 0 && event.altKey);
    if(panning) {
        gesture = { kind: "pan", x: event.clientX, y: event.clientY, origin: { ...pan } };
        elements.canvasWrap.classList.add("panning");
    } else if(event.button === 0 && tool === "select") {
        selectAt(event);
        return;
    } else if(event.button === 0 && tool === "object") {
        placeObjectAt(event);
        return;
    } else if(event.button === 0 && ["entity", "player", "enemy"].includes(tool)) {
        placeEntityAt(event, tool === "entity" ? null : tool);
        return;
    } else if(event.button === 2 || (event.button === 0 && (tool === "tile" || tool === "erase"))) {
        const erase = event.button === 2 || tool === "erase";
        const blocked = paintPrecondition(erase);
        if(blocked) {
            setStatus(blocked, true);
            return;
        }
        gesture = { kind: "paint", erase, changed: false, anchorCell: null, lastCell: null };
        if(erase) eraseAt(event); else paintAt(event, false);
    } else {
        return;
    }
    elements.mapCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
});
elements.mapCanvas.addEventListener("pointermove", event => {
    if(state) {
        const point = canvasPoint(event);
        const layer = tileLayer();
        const cell = tool === "tile" && layer ? snappedPaintCell(event, layer) : cellFromPixel(state, layer, point.x, point.y);
        elements.cursorPixel.textContent = `Pixel ${Math.floor(point.x)}, ${Math.floor(point.y)}`;
        elements.cursorCell.textContent = cell ? `Cell ${cell.x}, ${cell.y}` : "Cell --, --";
    }
    if(gesture?.kind === "pan") {
        pan = { x: gesture.origin.x + event.clientX - gesture.x, y: gesture.origin.y + event.clientY - gesture.y };
        applyView();
    } else if(gesture?.kind === "paint") {
        if(gesture.erase) eraseAt(event); else paintAt(event, false);
    }
});
function finishGesture() {
    if(gesture?.kind === "paint" && gesture.changed) {
        state = history.push(state, gesture.erase ? "Erase stroke" : "Paint tile stroke");
        render();
    }
    gesture = null;
    elements.canvasWrap.classList.remove("panning");
}
elements.mapCanvas.addEventListener("pointerup", finishGesture);
elements.mapCanvas.addEventListener("pointercancel", finishGesture);
elements.mapCanvas.addEventListener("pointerleave", () => {
    if(!gesture) {
        elements.cursorPixel.textContent = "Pixel --, --";
        elements.cursorCell.textContent = "Cell --, --";
    }
});

elements.canvasWrap.addEventListener("wheel", event => {
    if(!state) return;
    event.preventDefault();
    const bounds = elements.canvasWrap.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const world = { x: (pointer.x - pan.x) / zoom, y: (pointer.y - pan.y) / zoom };
    zoom = Math.min(4, Math.max(.25, zoom * (event.deltaY < 0 ? 1.25 : .8)));
    pan = { x: pointer.x - world.x * zoom, y: pointer.y - world.y * zoom };
    applyView();
}, { passive: false });

function setZoom(nextZoom) {
    if(!state) return;
    const center = { x: elements.canvasWrap.clientWidth / 2, y: elements.canvasWrap.clientHeight / 2 };
    const world = { x: (center.x - pan.x) / zoom, y: (center.y - pan.y) / zoom };
    zoom = Math.min(4, Math.max(.25, nextZoom));
    pan = { x: center.x - world.x * zoom, y: center.y - world.y * zoom };
    applyView();
}
elements.zoomRange.addEventListener("input", () => setZoom(Number(elements.zoomRange.value) / 100));
elements.zoomInButton.addEventListener("click", () => setZoom(zoom + .25));
elements.zoomOutButton.addEventListener("click", () => setZoom(zoom - .25));
elements.resetViewButton.addEventListener("click", () => centerView(1));
elements.fitViewButton.addEventListener("click", fitView);

initializePanelTitles();
initializePillEditors();

globalThis.addEventListener("keydown", event => {
    if(!state || elements.commandsDialog.open) return;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    const command = event.ctrlKey || event.metaKey;
    if(command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if(event.shiftKey) redo(); else undo();
    } else if(command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
    } else if(!typing && !command && !event.altKey && event.key.toLowerCase() === "g") {
        elements.gridToggle.checked = !elements.gridToggle.checked;
        setRendererState();
    } else if(!typing && !command && !event.altKey && ["s", "t", "o", "n", "p", "e", "x"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        setTool({ s: "select", t: "tile", o: "object", n: "entity", p: "player", e: "enemy", x: "erase" }[event.key.toLowerCase()]);
    }
});
globalThis.addEventListener("beforeunload", event => {
    if(isDirty()) {
        event.preventDefault();
        event.returnValue = "";
    }
});
