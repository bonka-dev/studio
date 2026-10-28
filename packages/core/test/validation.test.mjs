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
        inputMaps: new Map(),
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

test("validates opaque entity behavior input-action subscriptions", () => {
    const entity = {
        formatVersion: 1,
        type: "entity",
        id: "sample-entity",
        name: "Sample Entity",
        components: { behavior: { id: "character-control" } },
    };
    assert.equal(validateDocument("entity", entity), entity);

    const invalidId = structuredClone(entity);
    invalidId.components.behavior.id = "Character Control";
    assert.throws(
        () => validateDocument("entity", invalidId),
        error => error instanceof BonkaProjectError && error.message.includes("behavior/id")
    );

    const duplicateActions = structuredClone(entity);
    duplicateActions.components.behavior.inputActions = ["move-up", "move-up"];
    assert.throws(
        () => validateDocument("entity", duplicateActions),
        error => error instanceof BonkaProjectError && error.message.includes("inputActions")
    );

    entity.components.behavior.parameters = {
        movementSpace: "screen",
        speed: 1.25,
        normalizeDiagonal: true,
    };
    assert.equal(validateDocument("entity", entity), entity);
    const nestedParameter = structuredClone(entity);
    nestedParameter.components.behavior.parameters.invalid = { nested: true };
    assert.throws(
        () => validateDocument("entity", nestedParameter),
        error => error instanceof BonkaProjectError && error.message.includes("parameters/invalid")
    );
    const nonFiniteParameter = structuredClone(entity);
    nonFiniteParameter.components.behavior.parameters.speed = Infinity;
    assert.throws(
        () => validateDocument("entity", nonFiniteParameter),
        error => error instanceof BonkaProjectError && error.message.includes("parameters/speed")
    );
});

test("validates GBA input-map actions and bindings", () => {
    const inputMap = {
        formatVersion: 1,
        type: "inputMap",
        id: "default",
        name: "Default",
        actions: [{
            id: "move-up",
            bindings: [{ platform: "gba", control: "up", trigger: "held" }],
        }],
    };
    assert.equal(validateDocument("inputMap", inputMap), inputMap);

    for(const [field, value] of [["control", "x"], ["trigger", "tapped"], ["platform", "browser"]]) {
        const invalid = structuredClone(inputMap);
        invalid.actions[0].bindings[0][field] = value;
        assert.throws(() => validateDocument("inputMap", invalid), BonkaProjectError);
    }
    const noBindings = structuredClone(inputMap);
    noBindings.actions[0].bindings = [];
    assert.throws(() => validateDocument("inputMap", noBindings), BonkaProjectError);

    const project = createProjectGraph();
    project.inputMaps.set(inputMap.id, inputMap);
    project.manifest.inputMap = inputMap.id;
    assert.equal(validateProjectGraph(project), project);

    project.manifest.inputMap = "missing";
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("unknown input map 'missing'")
    );

    project.manifest.inputMap = inputMap.id;
    inputMap.actions.push(structuredClone(inputMap.actions[0]));
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("duplicate input action ID 'move-up'")
    );

    inputMap.actions.pop();
    project.entities.set("controlled", {
        id: "controlled",
        components: { behavior: { id: "control", inputActions: ["missing-action"] } },
    });
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError
            && error.message.includes("unknown input action 'missing-action' in selected input map 'default'")
    );

    project.entities.clear();
    inputMap.actions = Array.from({ length: 33 }, (_, index) => ({
        id: `action-${index}`,
        bindings: [{ platform: "gba", control: "a", trigger: "held" }],
    }));
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("at most 32 actions")
    );
});

test("validates sprite sheet layouts", () => {
    const sprite = {
        formatVersion: 1,
        type: "sprite",
        id: "sample-sprite",
        source: "sprite.png",
        frameSize: { width: 16, height: 16 },
        frameCount: 4,
        layout: {
            imageWidth: 42,
            imageHeight: 42,
            columns: 2,
            rows: 2,
            margin: { x: 2, y: 2 },
            spacing: { x: 4, y: 4 },
        },
        animations: { idle: { loop: true, frames: [{ index: 0, duration: 1 }] } },
        gba: { colors: 16, bpp: 4 },
    };
    assert.equal(validateDocument("sprite", sprite), sprite);

    const project = createProjectGraph();
    project.sprites.set(sprite.id, sprite);
    assert.equal(validateProjectGraph(project), project);

    const directional = structuredClone(sprite);
    directional.directionalSets = [{
        id: "idle",
        variants: [
            { label: "right", angle: 0, animation: "idle" },
            { label: "left", angle: 180, animation: "idle" },
        ],
    }];
    project.sprites.set(sprite.id, directional);
    assert.equal(validateProjectGraph(project), project);

    const entity = {
        id: "sample-entity",
        components: { sprite: { asset: sprite.id, directionalSet: "idle" } },
    };
    project.entities.set(entity.id, entity);
    assert.equal(validateProjectGraph(project), project);

    const missingDirectionalSet = structuredClone(entity);
    missingDirectionalSet.components.sprite.directionalSet = "missing";
    project.entities.set(entity.id, missingDirectionalSet);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("unknown directional set 'missing'")
    );
    project.entities.set(entity.id, entity);

    const duplicateAngle = structuredClone(directional);
    duplicateAngle.directionalSets[0].variants[1].angle = 0;
    project.sprites.set(sprite.id, duplicateAngle);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("duplicate directional variant angle 0")
    );

    const missingAnimation = structuredClone(directional);
    missingAnimation.directionalSets[0].variants[1].animation = "missing";
    project.sprites.set(sprite.id, missingAnimation);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("unknown animation 'missing'")
    );

    project.sprites.set(sprite.id, sprite);

    const oversized = structuredClone(sprite);
    oversized.layout.imageWidth = 37;
    project.sprites.set(sprite.id, oversized);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("grid requires 38x38 pixels")
    );

    const tooManyFrames = structuredClone(sprite);
    tooManyFrames.frameCount = 5;
    project.sprites.set(sprite.id, tooManyFrames);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("frame count 5 exceeds layout capacity 4")
    );
});

test("validates portable sprite authoring layers", () => {
    const sprite = {
        formatVersion: 1,
        type: "sprite",
        id: "drawn-sprite",
        source: "drawn-sprite.png",
        frameSize: { width: 8, height: 8 },
        frameCount: 1,
        layout: { imageWidth: 8, imageHeight: 8, columns: 1, rows: 1, margin: { x: 0, y: 0 }, spacing: { x: 0, y: 0 } },
        authoring: {
            version: 1,
            width: 8,
            height: 8,
            layers: [
                { id: "drawing-1", name: "Drawing", visible: true, kind: "drawing", pixels: Array(64).fill(null) },
                { id: "background-1", name: "Background", visible: true, kind: "reference", width: 16, height: 8, offset: { x: -4, y: 0 }, opacity: .5, pixels: Array(128).fill(null) },
            ],
        },
        animations: { idle: { loop: true, frames: [{ index: 0, duration: 1 }] } },
        gba: { colors: 16, bpp: 4 },
    };
    assert.equal(validateDocument("sprite", sprite), sprite);

    const project = createProjectGraph();
    project.sprites.set(sprite.id, sprite);
    assert.equal(validateProjectGraph(project), project);

    const incomplete = structuredClone(sprite);
    incomplete.authoring.layers[0].pixels.pop();
    project.sprites.set(sprite.id, incomplete);
    assert.throws(
        () => validateProjectGraph(project),
        error => error instanceof BonkaProjectError && error.message.includes("must contain exactly 64 pixels")
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

test("validates visual prefab metatile references and bounds", () => {
    const project = createProjectGraph();
    project.prefabs = new Map([["sample-prefab", {
        id: "sample-prefab",
        columns: 2,
        rows: 1,
        placements: [{ metatile: "sample-metatile", cell: { x: 1, y: 0 } }],
    }]]);
    assert.doesNotThrow(() => validateProjectGraph(project));

    project.prefabs.get("sample-prefab").placements[0].cell.x = 2;
    assert.throws(() => validateProjectGraph(project), /outside prefab bounds/);
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
