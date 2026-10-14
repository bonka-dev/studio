import { validateProjectDocuments } from "@bonka/core";

function clone(value) {
    return structuredClone(value);
}

function nextId(documents, prefix, fallback) {
    let result = fallback;
    for(const document of documents) {
        const match = document.id?.match(new RegExp(`^${prefix}-(\\d+)$`));
        if(match) result = Math.max(result, Number(match[1]) + 1);
    }
    return result;
}

export function toResourceId(value, fallback = "resource") {
    const id = value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return id || fallback;
}

export function allocateResourceId(value, usedIds, fallback = "resource") {
    const base = toResourceId(value, fallback);
    let candidate = base;
    for(let suffix = 2; usedIds.has(candidate); ++suffix) {
        candidate = `${base}-${suffix}`;
    }
    usedIds.add(candidate);
    return candidate;
}

export function readPngDimensions(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if(data.length < 24 || signature.some((byte, index) => data[index] !== byte) ||
        String.fromCharCode(...data.subarray(12, 16)) !== "IHDR") {
        throw new Error("File is not a valid PNG image");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if(width < 1 || height < 1) {
        throw new Error("PNG dimensions must be greater than zero");
    }
    return { width, height };
}

export function createTilesetDocument({ id, name, imageWidth, imageHeight, tileWidth = 8, tileHeight = 8 }) {
    if(! Number.isInteger(tileWidth) || ! Number.isInteger(tileHeight) || tileWidth < 1 || tileHeight < 1) {
        throw new Error("Base tile dimensions must be positive integers");
    }
    if(imageWidth % tileWidth || imageHeight % tileHeight) {
        throw new Error(`${name}: ${imageWidth}x${imageHeight} is not divisible by ${tileWidth}x${tileHeight}`);
    }
    const columns = imageWidth / tileWidth;
    return {
        formatVersion: 1,
        type: "tileset",
        id,
        name,
        source: `${id}.png`,
        tileSize: { width: tileWidth, height: tileHeight },
        layout: {
            imageWidth,
            imageHeight,
            columns,
            tileCount: columns * (imageHeight / tileHeight),
            margin: 0,
            spacing: 0,
        },
    };
}

function validateTileSize(tileSize, source) {
    if(! tileSize || ! Number.isInteger(tileSize.width) || ! Number.isInteger(tileSize.height) ||
        tileSize.width < 1 || tileSize.height < 1) {
        throw new Error(`${source} tile dimensions must be positive integers`);
    }
    return { width: tileSize.width, height: tileSize.height };
}

export function inferMetatileTileSize(tiles, tilesets, fallbackTileSize) {
    let result = null;
    for(const tile of tiles ?? []) {
        if(tile === null) continue;
        const tileset = tilesets.get(tile.tileset);
        if(! tileset) {
            throw new Error(`Metatile references unknown tileset '${tile.tileset}'`);
        }
        const tileSize = validateTileSize(tileset.tileSize, `Tileset '${tile.tileset}'`);
        if(result && (result.width !== tileSize.width || result.height !== tileSize.height)) {
            throw new Error("A metatile cannot mix tilesets with different base tile sizes");
        }
        result = tileSize;
    }
    return result ?? validateTileSize(fallbackTileSize, "Metatile");
}

export function createMetatileDocument({ id, name, columns = 4, rows = 4, tileSize, tiles = null }) {
    if(! Number.isInteger(columns) || ! Number.isInteger(rows) || columns < 1 || rows < 1) {
        throw new Error("Metatile columns and rows must be positive integers");
    }
    return {
        formatVersion: 1,
        type: "metatile",
        id: toResourceId(id || name, "metatile"),
        name: name?.trim() || id,
        columns,
        rows,
        tileSize: validateTileSize(tileSize, "Metatile"),
        visible: true,
        opacity: 1,
        tiles: tiles ? clone(tiles) : Array(columns * rows).fill(null),
        collision: Array(columns * rows).fill(0),
    };
}

export function addMetatile(project, options) {
    const usedIds = new Set(project.metatiles.keys());
    const id = allocateResourceId(options.id || options.name, usedIds, "metatile");
    const tileSize = inferMetatileTileSize(options.tiles, project.tilesets, options.tileSize);
    const metatile = createMetatileDocument({ ...options, id, tileSize });
    const relativePath = `metatiles/${id}.metatile.json`;
    project.metatiles.set(id, metatile);
    project.resourcePaths.set(`metatile:${id}`, relativePath);
    project.manifest.resources.metatiles.push(relativePath);
    return metatile;
}

export function addEntityDefinition(project, { id, name, components } = {}) {
    const usedIds = new Set(project.entities.keys());
    const entityId = allocateResourceId(id, usedIds, "entity");
    const entity = {
        formatVersion: 1,
        type: "entity",
        id: entityId,
        name: name?.trim() || entityId,
        components: components && Object.keys(components).length ? clone(components) : {
            collider: { shape: "box", width: 1, height: 1 },
        },
    };
    const relativePath = `entities/${entityId}.entity.json`;
    project.entities.set(entityId, entity);
    project.resourcePaths.set(`entity:${entityId}`, relativePath);
    project.manifest.resources.entities.push(relativePath);
    return entity;
}

export function ensureTileLayer(state) {
    const existing = state.layers.find(layer => layer.type === "tile");
    if(existing) {
        return existing;
    }
    const id = `layer-${state.scene.nextLayerId++}`;
    const layer = {
        id,
        name: "Tiles",
        type: "tile",
        level: 0,
        sourceHasLevel: false,
        visible: true,
        opacity: 1,
        order: state.layers.length,
        hOffset: 0,
        zOffset: 0,
        dirty: true,
        placements: [],
        objects: [],
    };
    state.layers.push(layer);
    return layer;
}

function layerToEditor(layer) {
    const base = {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        level: layer.level ?? 0,
        sourceHasLevel: layer.level !== undefined,
        visible: layer.visible,
        opacity: layer.opacity,
        order: layer.order,
        hOffset: layer.offset.x,
        zOffset: -layer.offset.y,
        dirty: false,
    };
    if(layer.type === "group") {
        return { ...base, layers: layer.layers.map(layerToEditor) };
    }
    return {
        ...base,
        placements: layer.placements.map(placement => ({
            metatileId: placement.metatile,
            x: placement.cell.x,
            y: placement.cell.y,
            flipX: placement.flip?.x ?? false,
            flipY: placement.flip?.y ?? false,
            sourceHasFlip: placement.flip !== undefined,
        })),
        objects: layer.objects.map(object => ({
            id: object.id,
            kind: "object",
            name: object.name,
            visible: object.visible,
            x: object.cell.x,
            y: object.cell.y,
            ...(object.properties === undefined ? {} : { properties: clone(object.properties) }),
        })),
    };
}

function layerFromEditor(layer) {
    const base = {
        id: layer.id,
        type: layer.type,
        name: layer.name,
        ...(! layer.sourceHasLevel ? {} : { level: layer.level }),
        visible: layer.visible,
        opacity: layer.opacity,
        order: layer.order,
        offset: { x: layer.hOffset, y: -layer.zOffset },
    };
    if(layer.type === "group") {
        return { ...base, layers: layer.layers.map(layerFromEditor) };
    }
    return {
        ...base,
        placements: layer.placements.map(placement => ({
            metatile: placement.metatileId,
            cell: { x: placement.x, y: placement.y },
            ...(placement.sourceHasFlip === false && ! placement.flipX && ! placement.flipY ? {} : {
                flip: { x: Boolean(placement.flipX), y: Boolean(placement.flipY) },
            }),
        })),
        objects: layer.objects.map(object => ({
            id: object.id,
            name: object.name,
            visible: object.visible,
            cell: { x: object.x, y: object.y },
            ...(object.properties === undefined ? {} : { properties: clone(object.properties) }),
        })),
    };
}

export function projectToEditorState(project, sourceUrls = new Map()) {
    const sourceScene = project.scenes.get(project.manifest.startScene);
    const tilesetDocuments = sourceScene.tilesets.map(id => project.tilesets.get(id));
    const flatLayers = sourceScene.layers.flatMap(function flatten(layer) {
        return layer.type === "group" ? [layer, ...layer.layers.flatMap(flatten)] : [layer];
    });
    const objects = flatLayers.flatMap(layer => layer.type === "group" ? [] : layer.objects);
    const metatileDocuments = [...project.metatiles.values()];
    return {
        projectName: project.manifest.name,
        scene: {
            id: sourceScene.id,
            name: sourceScene.name,
            createdWith: clone(sourceScene.createdWith),
            orientation: sourceScene.orientation,
            width: sourceScene.size.columns,
            height: sourceScene.size.rows,
            gridWidth: sourceScene.grid.width,
            gridHeight: sourceScene.grid.height,
            collisionGridWidth: sourceScene.collisionGrid.width,
            collisionGridHeight: sourceScene.collisionGrid.height,
            tileWidth: sourceScene.tileSize.width,
            tileHeight: sourceScene.tileSize.height,
            tilesetIds: [...sourceScene.tilesets],
            nextLayerId: nextId(flatLayers, "layer", sourceScene.editor?.nextLayerId ?? 0),
            nextObjectId: nextId(objects, "object", sourceScene.editor?.nextObjectId ?? 0),
            nextTilesetId: nextId(tilesetDocuments, "tileset", sourceScene.editor?.nextTilesetId ?? 0),
            nextMetatileId: nextId(metatileDocuments, "metatile", sourceScene.editor?.nextMetatileId ?? 0),
            sourceHasEditor: sourceScene.editor !== undefined,
        },
        layers: sourceScene.layers.map(layerToEditor),
        entities: sourceScene.entities.map(instance => ({
            id: instance.id,
            entity: true,
            kind: instance.definition,
            definition: instance.definition,
            name: instance.id,
            visible: true,
            x: instance.cell.x,
            y: instance.cell.y,
            ...(instance.overrides === undefined ? {} : { overrides: clone(instance.overrides) }),
        })),
        tilesets: tilesetDocuments.map(tileset => ({
            id: tileset.id,
            name: tileset.name,
            imageName: tileset.source,
            image: sourceUrls.get(`tileset:${tileset.id}`) ?? tileset.source,
            imageWidth: tileset.layout.imageWidth,
            imageHeight: tileset.layout.imageHeight,
            columns: tileset.layout.columns,
            tileCount: tileset.layout.tileCount,
            tileWidth: tileset.tileSize.width,
            tileHeight: tileset.tileSize.height,
            margin: tileset.layout.margin,
            spacing: tileset.layout.spacing,
        })),
        metatiles: metatileDocuments.map(metatile => ({
            id: metatile.id,
            name: metatile.name,
            type: "metatile",
            columns: metatile.columns,
            rows: metatile.rows,
            tileWidth: metatile.tileSize.width,
            tileHeight: metatile.tileSize.height,
            visible: metatile.visible,
            opacity: metatile.opacity,
            data: clone(metatile.tiles),
            collisionMap: [...metatile.collision],
        })),
    };
}

export function applyEditorState(project, state) {
    project.manifest.name = state.projectName;
    const scene = project.scenes.get(project.manifest.startScene);
    Object.assign(scene, {
        name: state.scene.name,
        orientation: state.scene.orientation,
        size: { columns: state.scene.width, rows: state.scene.height },
        grid: { width: state.scene.gridWidth, height: state.scene.gridHeight },
        collisionGrid: { width: state.scene.collisionGridWidth, height: state.scene.collisionGridHeight },
        tileSize: { width: state.scene.tileWidth, height: state.scene.tileHeight },
        tilesets: [...state.scene.tilesetIds],
        layers: state.layers.map(layerFromEditor),
        entities: state.entities.map(instance => ({
            id: instance.id,
            definition: instance.definition,
            cell: { x: instance.x, y: instance.y },
            ...(instance.overrides === undefined ? {} : { overrides: clone(instance.overrides) }),
        })),
        ...(state.scene.sourceHasEditor === false ? {} : {
            editor: {
                nextLayerId: state.scene.nextLayerId,
                nextObjectId: state.scene.nextObjectId,
                nextTilesetId: state.scene.nextTilesetId,
                nextMetatileId: state.scene.nextMetatileId,
            },
        }),
    });

    for(const editorTileset of state.tilesets) {
        const tileset = project.tilesets.get(editorTileset.id);
        if(! tileset) {
            throw new Error(`Tileset '${editorTileset.id}' is not part of the opened project`);
        }
        Object.assign(tileset, {
            name: editorTileset.name,
            tileSize: { width: editorTileset.tileWidth, height: editorTileset.tileHeight },
            layout: {
                imageWidth: editorTileset.imageWidth,
                imageHeight: editorTileset.imageHeight,
                columns: editorTileset.columns,
                tileCount: editorTileset.tileCount,
                margin: editorTileset.margin,
                spacing: editorTileset.spacing,
            },
        });
    }

    for(const editorMetatile of state.metatiles) {
        const metatile = project.metatiles.get(editorMetatile.id);
        if(! metatile) {
            throw new Error(`Metatile '${editorMetatile.id}' is not part of the opened project`);
        }
        Object.assign(metatile, {
            name: editorMetatile.name,
            columns: editorMetatile.columns,
            rows: editorMetatile.rows,
            tileSize: { width: editorMetatile.tileWidth, height: editorMetatile.tileHeight },
            visible: editorMetatile.visible,
            opacity: editorMetatile.opacity,
            tiles: clone(editorMetatile.data),
            collision: [...editorMetatile.collisionMap],
        });
    }
    return validateProjectDocuments(project);
}

export function createProjectDocuments({
    name = "Untitled Project",
    sceneId = "scene-1",
    sceneName = "Scene 1",
    bonkaVersion = "0.3.0-dev",
} = {}) {
    const scenePath = `scenes/${sceneId}.scene.json`;
    const scene = {
        formatVersion: 1,
        type: "scene",
        id: sceneId,
        name: sceneName,
        orientation: "isometric",
        // 32x64 cells at the 16x8 isometric grid produce a 512x512 GBA canvas.
        size: { columns: 32, rows: 64 },
        grid: { width: 16, height: 8 },
        collisionGrid: { width: 16, height: 8 },
        tileSize: { width: 32, height: 32 },
        tilesets: [],
        layers: [{
            id: "layer-0",
            type: "tile",
            name: "Ground",
            visible: true,
            opacity: 1,
            order: 0,
            offset: { x: 0, y: 0 },
            placements: [],
            objects: [],
        }],
        entities: [],
        editor: {
            nextLayerId: 1,
            nextObjectId: 0,
            nextTilesetId: 0,
            nextMetatileId: 0,
        },
    };
    const project = {
        manifestPath: "bonka.config.json",
        rootDir: "",
        generatedDir: ".bonka",
        manifest: {
            formatVersion: 1,
            name,
            engine: "butano",
            startScene: sceneId,
            createdWith: { bonka: bonkaVersion },
            resources: {
                scenes: [scenePath],
                tilesets: [],
                metatiles: [],
                sprites: [],
                entities: [],
            },
        },
        scenes: new Map([[sceneId, scene]]),
        tilesets: new Map(),
        metatiles: new Map(),
        sprites: new Map(),
        entities: new Map(),
        resourcePaths: new Map([[`scene:${sceneId}`, scenePath]]),
        sourcePaths: new Map(),
    };
    return validateProjectDocuments(project);
}

export function allocateEntityId(instances, definition) {
    const used = new Set(instances.map(instance => instance.id));
    for(let index = 1; ; ++index) {
        const candidate = `${definition}-${String(index).padStart(3, "0")}`;
        if(! used.has(candidate)) {
            return candidate;
        }
    }
}

export function addEntityInstance(state, { definition, x, y, id } = {}) {
    const instanceId = id ?? allocateEntityId(state.entities, definition);
    if(state.entities.some(instance => instance.id === instanceId)) {
        throw new Error(`Entity instance ID '${instanceId}' is already in use`);
    }
    const instance = {
        id: instanceId,
        entity: true,
        kind: definition,
        definition,
        name: instanceId,
        visible: true,
        x,
        y,
    };
    state.entities.push(instance);
    return instance;
}

export function removeEntityInstance(state, id) {
    const index = state.entities.findIndex(instance => instance.id === id);
    if(index === -1) return false;
    state.entities.splice(index, 1);
    return true;
}
