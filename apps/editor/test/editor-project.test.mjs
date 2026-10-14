import assert from "node:assert/strict";
import { test } from "node:test";

import {
    addEntityDefinition,
    addEntityInstance,
    applyEditorState,
    allocateResourceId,
    createMetatileDocument,
    createProjectDocuments,
    createTilesetDocument,
    ensureTileLayer,
    inferMetatileTileSize,
    projectToEditorState,
    readPngDimensions,
    removeEntityInstance,
    toResourceId,
} from "../src/project/editor-project.mjs";

test("creates a valid empty Project Format v1 project", () => {
    const project = createProjectDocuments({
        name: "Sample Project",
        sceneId: "sample-scene",
        sceneName: "Sample Scene",
        bonkaVersion: "0.3.0-dev",
    });

    assert.equal(project.manifestPath, "bonka.config.json");
    assert.deepEqual(project.manifest.resources, {
        scenes: ["scenes/sample-scene.scene.json"],
        tilesets: [],
        metatiles: [],
        sprites: [],
        entities: [],
    });
    assert.equal(project.scenes.get("sample-scene").name, "Sample Scene");
    assert.deepEqual(project.scenes.get("sample-scene").size, { columns: 32, rows: 64 });
    assert.equal(project.scenes.get("sample-scene").layers[0].id, "layer-0");
    assert.deepEqual(project.metatiles, new Map());
    assert.equal(projectToEditorState(project).projectName, "Sample Project");
});

test("normalizes resource IDs and allocates collision-safe suffixes", () => {
    assert.equal(toResourceId("  Forest Tiles.PNG  "), "forest-tiles-png");
    const used = new Set(["forest-tiles", "forest-tiles-2"]);
    assert.equal(allocateResourceId("Forest Tiles", used), "forest-tiles-3");
});

test("reads PNG dimensions from IHDR", () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 32);
    view.setUint32(20, 32);
    assert.deepEqual(readPngDimensions(bytes), { width: 32, height: 32 });
    assert.throws(() => readPngDimensions(new Uint8Array(24)), /valid PNG/);
});

test("creates a 32x32 tileset with an 8x8 base tile layout", () => {
    const tileset = createTilesetDocument({
        id: "forest",
        name: "Forest",
        imageWidth: 32,
        imageHeight: 32,
    });
    assert.equal(tileset.layout.columns, 4);
    assert.equal(tileset.layout.tileCount, 16);
    assert.equal(tileset.source, "forest.png");
    assert.equal(Object.hasOwn(tileset, "metatiles"), false);
});

test("creates standalone metatiles with cross-tileset cells", () => {
    const metatile = createMetatileDocument({
        id: "ground",
        name: "Ground",
        columns: 2,
        rows: 1,
        tileSize: { width: 8, height: 8 },
        tiles: [null, { tileset: "forest", tile: 3 }],
    });
    assert.deepEqual(metatile.tileSize, { width: 8, height: 8 });
    assert.deepEqual(metatile.tiles, [null, { tileset: "forest", tile: 3 }]);
    assert.deepEqual(metatile.collision, [0, 0]);
});

test("infers a metatile tile size and rejects mixed source sizes", () => {
    const tilesets = new Map([
        ["forest", { tileSize: { width: 8, height: 8 } }],
        ["water", { tileSize: { width: 8, height: 8 } }],
        ["large", { tileSize: { width: 16, height: 8 } }],
    ]);
    assert.deepEqual(inferMetatileTileSize([
        { tileset: "forest", tile: 0 },
        null,
        { tileset: "water", tile: 2 },
    ], tilesets, { width: 32, height: 32 }), { width: 8, height: 8 });
    assert.deepEqual(inferMetatileTileSize([null], tilesets, { width: 16, height: 16 }), {
        width: 16,
        height: 16,
    });
    assert.throws(() => inferMetatileTileSize([
        { tileset: "forest", tile: 0 },
        { tileset: "large", tile: 0 },
    ], tilesets, { width: 8, height: 8 }), /different base tile sizes/);
});

test("creates one basic tile layer and keeps placement references metatile-only", () => {
    const project = createProjectDocuments();
    const state = projectToEditorState(project);
    const layer = ensureTileLayer(state);
    layer.placements.push({
        metatileId: "ground",
        x: 2,
        y: 3,
        flipX: false,
        flipY: false,
        sourceHasFlip: false,
    });
    assert.equal(ensureTileLayer(state), layer);
    assert.equal(layer.placements[0].metatileId, "ground");
    assert.equal(Object.hasOwn(layer.placements[0], "tilesetId"), false);
});

test("adds generic entity definitions and round-trips scene instances", () => {
    const project = createProjectDocuments();
    const definition = addEntityDefinition(project, { id: "Moving Platform", name: "Moving Platform" });
    assert.deepEqual(definition.components, {
        collider: { shape: "box", width: 1, height: 1 },
    });
    assert.equal(project.entities.get("moving-platform"), definition);
    assert.equal(project.resourcePaths.get("entity:moving-platform"), "entities/moving-platform.entity.json");
    assert.deepEqual(project.manifest.resources.entities, ["entities/moving-platform.entity.json"]);

    const state = projectToEditorState(project);
    const first = addEntityInstance(state, { definition: definition.id, x: 2, y: 3 });
    const second = addEntityInstance(state, { definition: definition.id, x: 4, y: 5 });
    assert.equal(first.id, "moving-platform-001");
    assert.equal(second.id, "moving-platform-002");
    assert.equal(removeEntityInstance(state, first.id), true);
    assert.equal(removeEntityInstance(state, "missing-instance"), false);

    applyEditorState(project, state);
    assert.deepEqual(project.scenes.get(project.manifest.startScene).entities, [{
        id: "moving-platform-002",
        definition: "moving-platform",
        cell: { x: 4, y: 5 },
    }]);
    assert.equal(projectToEditorState(project).entities[0].kind, "moving-platform");
});

test("accepts custom generic entity components and explicit instance IDs", () => {
    const project = createProjectDocuments();
    const components = { behavior: { id: "follow-path" } };
    const definition = addEntityDefinition(project, { id: "marker", components });
    components.behavior.id = "changed";
    assert.deepEqual(definition.components, { behavior: { id: "follow-path" } });

    const state = projectToEditorState(project);
    assert.equal(addEntityInstance(state, {
        definition: "marker",
        x: 0,
        y: 0,
        id: "entrance-marker",
    }).id, "entrance-marker");
    assert.throws(() => addEntityInstance(state, {
        definition: "marker",
        x: 1,
        y: 1,
        id: "entrance-marker",
    }), /already in use/);
});
