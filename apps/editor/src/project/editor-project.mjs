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
            tilesetId: placement.tileset,
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
            tileset: placement.tilesetId,
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
    const metatileDocuments = tilesetDocuments.flatMap(tileset => tileset.metatiles);
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
        metatiles: tilesetDocuments.flatMap(tileset => tileset.metatiles.map(metatile => ({
            id: metatile.id,
            tilesetId: tileset.id,
            name: metatile.name,
            type: "metatile",
            columns: metatile.columns,
            rows: metatile.rows,
            visible: metatile.visible,
            opacity: metatile.opacity,
            data: [...metatile.tiles],
            collisionMap: [...metatile.collision],
        }))),
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
            metatiles: state.metatiles
                .filter(metatile => metatile.tilesetId === editorTileset.id)
                .map(metatile => ({
                    id: metatile.id,
                    name: metatile.name,
                    columns: metatile.columns,
                    rows: metatile.rows,
                    visible: metatile.visible,
                    opacity: metatile.opacity,
                    tiles: [...metatile.data],
                    collision: [...metatile.collisionMap],
                })),
        });
    }
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
