import assert from "node:assert/strict";
import { test } from "node:test";

import {
    BonkaProjectError,
    loadBonkaProjectWithAdapter,
    validateDocument,
    validateProjectGraph,
} from "../src/index.mjs";

function createProjectGraph() {
    const tileset = {
        id: "sample-tileset",
        tileSize: { width: 8, height: 8 },
        layout: {
            imageWidth: 8,
            imageHeight: 8,
            columns: 1,
            tileCount: 1,
            margin: 0,
            spacing: 0,
        },
    };
    const metatile = {
        id: "sample-metatile",
        tileSize: { width: 8, height: 8 },
        columns: 1,
        rows: 1,
        tiles: [{ tileset: "sample-tileset", tile: 0 }],
        collision: [0],
    };
    const scene = {
        id: "sample-scene",
        size: { columns: 1, rows: 1 },
        tileSize: { width: 8, height: 8 },
        tilesets: ["sample-tileset"],
        layers: [{
            id: "sample-layer",
            type: "tile",
            placements: [{ metatile: "sample-metatile", cell: { x: 0, y: 0 } }],
            objects: [],
        }],
        entities: [],
    };
    return {
        manifest: { startScene: "sample-scene" },
        scenes: new Map([[scene.id, scene]]),
        tilesets: new Map([[tileset.id, tileset]]),
        metatiles: new Map([[metatile.id, metatile]]),
        sprites: new Map(),
        entities: new Map(),
    };
}

test("rejects a project document missing required fields", () => {
    assert.throws(
        () => validateDocument("project", { formatVersion: 1 }, "fixture/project.json"),
        error => error instanceof BonkaProjectError
            && error.message.includes("fixture/project.json/name")
    );
});

test("rejects unknown entity components", () => {
    assert.throws(
        () => validateDocument("entity", {
            formatVersion: 1,
            type: "entity",
            id: "sample-entity",
            name: "Sample Entity",
            components: {
                unknown: {},
            },
        }),
        error => error instanceof BonkaProjectError
            && error.message.includes("additional properties")
    );
});

test("validates standalone metatile documents", () => {
    const metatile = {
        formatVersion: 1,
        type: "metatile",
        id: "sample-metatile",
        name: "Sample Metatile",
        tileSize: { width: 8, height: 8 },
        columns: 1,
        rows: 1,
        visible: true,
        opacity: 1,
        tiles: [{ tileset: "sample-tileset", tile: 0 }],
        collision: [0],
    };

    assert.equal(validateDocument("metatile", metatile), metatile);
    const missingTileSize = { ...metatile };
    delete missingTileSize.tileSize;
    assert.throws(
        () => validateDocument("metatile", missingTileSize),
        error => error instanceof BonkaProjectError && error.message.includes("metatile/tileSize")
    );
    assert.throws(
        () => validateDocument("tileset", {
            formatVersion: 1,
            type: "tileset",
            id: "sample-tileset",
            name: "Sample Tileset",
            source: "tiles.png",
            tileSize: { width: 8, height: 8 },
            layout: { imageWidth: 8, imageHeight: 8, columns: 1, tileCount: 1, margin: 0, spacing: 0 },
            metatiles: [],
        }),
        error => error instanceof BonkaProjectError && error.message.includes("additional properties")
    );
});

test("rejects invalid metatile array lengths", () => {
    const project = createProjectGraph();
    project.metatiles.get("sample-metatile").tiles = [];
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("expected 1 entries, received 0")
    );

    const collisionProject = createProjectGraph();
    collisionProject.metatiles.get("sample-metatile").collision = [];
    assert.throws(
        () => validateProjectGraph(collisionProject),
        error => error instanceof BonkaProjectError && error.message.includes("expected 1 entries, received 0")
    );
});

test("validates metatile tileset references and tile bounds", () => {
    const missingTileset = createProjectGraph();
    missingTileset.metatiles.get("sample-metatile").tiles[0].tileset = "missing-tileset";
    assert.throws(
        () => validateProjectGraph(missingTileset),
        error => error instanceof BonkaProjectError && error.message.includes("unknown tileset 'missing-tileset'")
    );

    const outOfRange = createProjectGraph();
    outOfRange.metatiles.get("sample-metatile").tiles[0].tile = 1;
    assert.throws(
        () => validateProjectGraph(outOfRange),
        error => error instanceof BonkaProjectError && error.message.includes("tile index 1 exceeds tile count 1")
    );

    const mismatchedTileSize = createProjectGraph();
    mismatchedTileSize.metatiles.get("sample-metatile").tileSize.width = 16;
    assert.throws(
        () => validateProjectGraph(mismatchedTileSize),
        error => error instanceof BonkaProjectError
            && error.details[0].path === "metatiles/sample-metatile/tiles/0/tileset"
            && error.message.includes("tileset 'sample-tileset' tile size 8x8 does not match metatile tile size 16x8")
    );
});

test("validates scene placement metatiles and their allowed tilesets", () => {
    const missingMetatile = createProjectGraph();
    missingMetatile.scenes.get("sample-scene").layers[0].placements[0].metatile = "missing-metatile";
    assert.throws(
        () => validateProjectGraph(missingMetatile),
        error => error instanceof BonkaProjectError && error.message.includes("unknown metatile 'missing-metatile'")
    );

    const undeclaredTileset = createProjectGraph();
    undeclaredTileset.scenes.get("sample-scene").tilesets = [];
    assert.throws(
        () => validateProjectGraph(undeclaredTileset),
        error => error instanceof BonkaProjectError
            && error.message.includes("uses tileset 'sample-tileset' not declared by the scene")
    );

    const wrongWidth = createProjectGraph();
    wrongWidth.metatiles.get("sample-metatile").columns = 2;
    wrongWidth.metatiles.get("sample-metatile").tiles.push(null);
    wrongWidth.metatiles.get("sample-metatile").collision.push(0);
    assert.throws(
        () => validateProjectGraph(wrongWidth),
        error => error instanceof BonkaProjectError
            && error.details[0].path === "scenes/sample-scene/layers/0/placements/0/metatile"
            && error.message.includes("width 16 does not match scene tile width 8")
    );

    const wrongHeight = createProjectGraph();
    wrongHeight.metatiles.get("sample-metatile").rows = 2;
    wrongHeight.metatiles.get("sample-metatile").tiles.push(null);
    wrongHeight.metatiles.get("sample-metatile").collision.push(0);
    assert.throws(
        () => validateProjectGraph(wrongHeight),
        error => error instanceof BonkaProjectError
            && error.details[0].path === "scenes/sample-scene/layers/0/placements/0/metatile"
            && error.message.includes("height 16 does not match scene tile height 8")
    );
});

test("rejects duplicate standalone metatile IDs while loading", async() => {
    const metatile = {
        formatVersion: 1,
        type: "metatile",
        id: "duplicate-metatile",
        name: "Duplicate Metatile",
        tileSize: { width: 8, height: 8 },
        columns: 1,
        rows: 1,
        visible: true,
        opacity: 1,
        tiles: [null],
        collision: [0],
    };
    const documents = new Map([
        ["manifest.json", {
            formatVersion: 1,
            name: "Duplicate fixture",
            engine: "butano",
            startScene: "unused-scene",
            resources: {
                scenes: [],
                tilesets: [],
                metatiles: ["first.json", "second.json"],
                sprites: [],
                entities: [],
            },
        }],
        ["first.json", metatile],
        ["second.json", { ...metatile }],
    ]);

    await assert.rejects(
        loadBonkaProjectWithAdapter({
            manifestPath: "manifest.json",
            rootDir: ".",
            generatedDir: ".bonka",
            readJson: async path => documents.get(path),
            resolveResource: async path => path,
            resolveAsset: async path => path,
        }),
        error => error instanceof BonkaProjectError
            && error.message.includes("duplicate metatile ID 'duplicate-metatile'")
    );
});
