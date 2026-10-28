import { snapBrushCell } from "./iso-brush.mjs";

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function ordered(layers) {
    return (layers ?? [])
        .map((layer, index) => ({ layer, index }))
        .sort((left, right) =>
            finiteNumber(left.layer.order, left.index) - finiteNumber(right.layer.order, right.index) ||
            left.index - right.index)
        .map(entry => entry.layer);
}

function flattenLayers(layers, type) {
    const result = [];

    function visit(children, inherited) {
        for(const layer of ordered(children)) {
            const flattened = {
                ...layer,
                visible: inherited.visible && layer.visible !== false,
                opacity: inherited.opacity * finiteNumber(layer.opacity, 1),
                hOffset: inherited.hOffset + finiteNumber(layer.hOffset, 0),
                zOffset: inherited.zOffset + finiteNumber(layer.zOffset, 0),
            };
            if(layer.type === "group") {
                visit(layer.layers, flattened);
            } else if(layer.type === type) {
                result.push(flattened);
            }
        }
    }

    visit(layers, { visible: true, opacity: 1, hOffset: 0, zOffset: 0 });
    return result;
}

export function flattenTileLayers(layers) {
    return flattenLayers(layers, "tile");
}

export function flattenObjectLayers(layers) {
    return flattenLayers(layers, "object");
}

export function orderedTilePlacements(layers) {
    return flattenTileLayers(layers)
        .flatMap((layer, layerIndex) => (layer.placements ?? []).map((placement, placementIndex) => ({
            layer,
            placement,
            layerIndex,
            placementIndex,
        })))
        .sort((left, right) =>
            finiteNumber(left.layer.order, left.layerIndex) - finiteNumber(right.layer.order, right.layerIndex) ||
            left.placement.y - right.placement.y ||
            left.placement.x - right.placement.x ||
            left.placementIndex - right.placementIndex);
}

export function scenePixelSize(state) {
    return {
        width: state.scene.width * state.scene.gridWidth,
        height: state.scene.height * state.scene.gridHeight,
    };
}

export function cellFromPixel(state, layer, x, y) {
    const cell = {
        x: Math.floor((x - finiteNumber(layer?.hOffset, 0)) / state.scene.gridWidth),
        y: Math.floor((y + finiteNumber(layer?.zOffset, 0)) / state.scene.gridHeight),
    };
    if(cell.x < 0 || cell.y < 0 || cell.x >= state.scene.width || cell.y >= state.scene.height) {
        return null;
    }
    return cell;
}

export function placementKey(x, y) {
    return `${x},${y}`;
}

export function upsertPlacement(layer, placement) {
    const placements = [...(layer.placements ?? [])];
    const key = placementKey(placement.x, placement.y);
    const index = placements.findIndex(item => placementKey(item.x, item.y) === key);
    if(index === -1) {
        placements.push(placement);
    } else {
        placements[index] = placement;
    }
    return { ...layer, placements };
}

export function removePlacement(layer, x, y) {
    return {
        ...layer,
        placements: (layer.placements ?? []).filter(item => item.x !== x || item.y !== y),
    };
}

function sourcePosition(tileset, tile) {
    const margin = finiteNumber(tileset.margin ?? tileset.layout?.margin, 0);
    const spacing = finiteNumber(tileset.spacing ?? tileset.layout?.spacing, 0);
    const columns = tileset.columns ?? tileset.layout?.columns;
    return {
        x: margin + (tile % columns) * (tileset.tileWidth + spacing),
        y: margin + Math.floor(tile / columns) * (tileset.tileHeight + spacing),
    };
}

function drawImageTile(context, image, source, width, height, x, y, flipX, flipY) {
    context.save();
    context.translate(x + (flipX ? width : 0), y + (flipY ? height : 0));
    context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    context.drawImage(image, source.x, source.y, width, height, 0, 0, width, height);
    context.restore();
}

function drawMetatile(context, state, images, metatile, placement, layer, alpha = 1) {
    if(! metatile || metatile.visible === false || ! finiteNumber(metatile.opacity, 1)) return;

    const flipX = Boolean(placement.flipX);
    const flipY = Boolean(placement.flipY);
    const originX = placement.x * state.scene.gridWidth + layer.hOffset;
    const originY = placement.y * state.scene.gridHeight - layer.zOffset;
    const previousAlpha = context.globalAlpha;
    context.globalAlpha = previousAlpha * layer.opacity * finiteNumber(metatile.opacity, 1) * alpha;

    for(let row = 0; row < metatile.rows; ++row) {
        for(let column = 0; column < metatile.columns; ++column) {
            const cell = metatile.data[row * metatile.columns + column];
            if(cell === null || cell === undefined) continue;
            const tileset = state.tilesets.find(item => item.id === cell.tileset);
            const image = images.get(cell.tileset);
            if(! tileset || ! image) continue;

            const destinationColumn = flipX ? metatile.columns - 1 - column : column;
            const destinationRow = flipY ? metatile.rows - 1 - row : row;
            drawImageTile(
                context,
                image,
                sourcePosition(tileset, cell.tile),
                metatile.tileWidth,
                metatile.tileHeight,
                originX + destinationColumn * metatile.tileWidth,
                originY + destinationRow * metatile.tileHeight,
                flipX,
                flipY
            );
        }
    }
    context.globalAlpha = previousAlpha;
}

function drawGrid(context, state, options) {
    const size = scenePixelSize(state);
    context.save();
    context.lineWidth = finiteNumber(options.gridLineWidth, 1);
    for(let x = 0, index = 0; x <= size.width; x += state.scene.gridWidth, ++index) {
        context.beginPath();
        context.strokeStyle = index % 2 === 0 ? "rgba(231,182,80,.20)" : "rgba(112,215,199,.09)";
        const position = Math.min(x + 0.5, size.width - 0.5);
        context.moveTo(position, 0);
        context.lineTo(position, size.height);
        context.stroke();
    }
    for(let y = 0, index = 0; y <= size.height; y += state.scene.gridHeight, ++index) {
        context.beginPath();
        context.strokeStyle = index % 4 === 0 ? "rgba(231,182,80,.20)" : "rgba(112,215,199,.07)";
        const position = Math.min(y + 0.5, size.height - 0.5);
        context.moveTo(0, position);
        context.lineTo(size.width, position);
        context.stroke();
    }
    context.restore();
}

function drawFootprints(context, state, layers, metatiles, options) {
    context.save();
    context.strokeStyle = options.footprintColor;
    context.lineWidth = finiteNumber(options.footprintLineWidth, 1);
    for(const layer of layers) {
        if(! layer.visible) continue;
        for(const placement of layer.placements ?? []) {
            const metatile = metatiles.get(placement.metatileId);
            if(! metatile) continue;
            context.strokeRect(
                placement.x * state.scene.gridWidth + layer.hOffset + 0.5,
                placement.y * state.scene.gridHeight - layer.zOffset + 0.5,
                metatile.columns * metatile.tileWidth - 1,
                metatile.rows * metatile.tileHeight - 1
            );
        }
    }
    context.restore();
}

function markerPosition(state, item, layer = null) {
    return {
        x: item.x * state.scene.gridWidth + finiteNumber(layer?.hOffset, 0) + state.scene.gridWidth / 2,
        y: item.y * state.scene.gridHeight - finiteNumber(layer?.zOffset, 0) + state.scene.gridHeight / 2,
    };
}

function drawMarker(context, state, item, layer, kind, selected) {
    const position = markerPosition(state, item, layer);
    context.save();
    context.globalAlpha *= finiteNumber(layer?.opacity, 1);
    context.translate(position.x, position.y);
    context.fillStyle = kind === "object" ? "#70d7c7" : "#e7b650";
    context.strokeStyle = selected ? "#e7b650" : "#10120f";
    context.lineWidth = selected ? 3 : 2;
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#10120f";
    context.font = "bold 8px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(kind === "object" ? "O" : "E", 0, .5);
    if(kind !== "object") {
        context.font = "7px monospace";
        context.textAlign = "left";
        context.fillText(kind, 10, 3);
    }
    context.restore();
}

function drawObjectMarkers(context, state, layers, options) {
    for(const layer of layers) {
        if(!layer.visible || !layer.opacity) continue;
        for(const object of layer.objects ?? []) {
            if(object.visible === false) continue;
            drawMarker(context, state, object, layer, "object", options.selectedObjectId === object.id);
        }
    }
}

function drawEntityMarkers(context, state, options) {
    for(const entity of state.entities ?? []) {
        if(entity.visible === false) continue;
        drawMarker(context, state, entity, null, entity.definition ?? entity.kind ?? "entity", options.selectedEntityId === entity.id);
    }
}

function imageConstructor(canvas) {
    return canvas.ownerDocument?.defaultView?.Image ?? globalThis.Image;
}

function loadImage(ImageType, url) {
    return new Promise((resolve, reject) => {
        const image = new ImageType();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Unable to load tileset image '${url}'`));
        image.src = url;
    });
}

export function createSceneRenderer(canvas) {
    const context = canvas.getContext("2d");
    if(! context) throw new Error("A 2D canvas context is required");

    let state = null;
    let disposed = false;
    let generation = 0;
    let pointer = null;
    const imageCache = new Map();
    const options = {
        showGrid: true,
        showFootprints: false,
        gridColor: "rgba(255, 255, 255, 0.22)",
        gridLineWidth: 1,
        footprintColor: "rgba(255, 196, 64, 0.85)",
        footprintLineWidth: 1,
        hoverOpacity: 0.55,
        hover: null,
        snapHover: false,
    };

    function requestImage(tileset) {
        const url = tileset.image;
        const cached = imageCache.get(tileset.id);
        if(cached?.url === url) return cached.promise;
        const ImageType = imageConstructor(canvas);
        if(! ImageType) throw new Error("Image is not available in this environment");
        const promise = loadImage(ImageType, url).catch(error => {
            if(imageCache.get(tileset.id)?.promise === promise) imageCache.delete(tileset.id);
            throw error;
        });
        imageCache.set(tileset.id, { url, promise });
        return promise;
    }

    async function render() {
        if(disposed || ! state) return;
        const renderGeneration = ++generation;
        const renderedState = state;
        const loaded = await Promise.allSettled((renderedState.tilesets ?? []).map(async tileset =>
            [tileset.id, await requestImage(tileset)]));
        if(disposed || renderGeneration !== generation || renderedState !== state) return;

        const images = new Map(loaded
            .filter(result => result.status === "fulfilled")
            .map(result => result.value));
        const size = scenePixelSize(renderedState);
        if(canvas.width !== size.width) canvas.width = size.width;
        if(canvas.height !== size.height) canvas.height = size.height;
        context.clearRect(0, 0, size.width, size.height);

        const layers = flattenTileLayers(renderedState.layers);
        const metatiles = new Map((renderedState.metatiles ?? []).map(item => [item.id, item]));
        for(const { layer, placement } of orderedTilePlacements(renderedState.layers)) {
            if(! layer.visible || ! layer.opacity) continue;
            drawMetatile(context, renderedState, images, metatiles.get(placement.metatileId), placement, layer);
        }

        if(options.showFootprints) drawFootprints(context, renderedState, layers, metatiles, options);

        drawObjectMarkers(context, renderedState, flattenObjectLayers(renderedState.layers), options);
        drawEntityMarkers(context, renderedState, options);

        const hover = options.hover ?? options.hoverGhost;
        const hoverMetatileId = hover?.metatileId ?? options.hoverMetatileId;
        if(hoverMetatileId) {
            const layer = layers.find(item => item.id === (hover?.layerId ?? options.hoverLayerId)) ??
                layers.at(-1) ?? { visible: true, opacity: 1, hOffset: 0, zOffset: 0 };
            const cell = Number.isInteger(hover?.x) && Number.isInteger(hover?.y)
                ? { x: hover.x, y: hover.y }
                : pointer && (options.snapHover
                    ? snapBrushCell(pointer, layer, renderedState.scene)
                    : cellFromPixel(renderedState, layer, pointer.x, pointer.y));
            if(cell && layer.visible) {
                drawMetatile(context, renderedState, images, metatiles.get(hoverMetatileId), {
                    x: cell.x,
                    y: cell.y,
                    flipX: hover?.flipX ?? options.flipX,
                    flipY: hover?.flipY ?? options.flipY,
                }, layer, finiteNumber(options.hoverOpacity, 0.55));
            }
        }

        if(options.showGrid) drawGrid(context, renderedState, options);
        const failures = loaded.filter(result => result.status === "rejected");
        if(failures.length) {
            throw new Error(failures.map(result => result.reason?.message ?? String(result.reason)).join("; "));
        }
    }

    function pointerMove(event) {
        const bounds = canvas.getBoundingClientRect();
        pointer = {
            x: (event.clientX - bounds.left) * canvas.width / bounds.width,
            y: (event.clientY - bounds.top) * canvas.height / bounds.height,
        };
        void render().catch(() => {});
    }

    function pointerLeave() {
        pointer = null;
        void render().catch(() => {});
    }

    canvas.addEventListener?.("pointermove", pointerMove);
    canvas.addEventListener?.("pointerleave", pointerLeave);

    const controller = {
        setState(nextState) {
            state = nextState;
            generation++;
            const ids = new Set((state?.tilesets ?? []).map(tileset => tileset.id));
            for(const id of imageCache.keys()) {
                if(! ids.has(id)) imageCache.delete(id);
            }
            return render();
        },
        setOptions(nextOptions) {
            Object.assign(options, nextOptions);
            return render();
        },
        render,
        dispose() {
            disposed = true;
            generation++;
            imageCache.clear();
            canvas.removeEventListener?.("pointermove", pointerMove);
            canvas.removeEventListener?.("pointerleave", pointerLeave);
        },
    };
    return controller;
}
