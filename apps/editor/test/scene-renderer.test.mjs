import assert from "node:assert/strict";
import { test } from "node:test";

import {
    cellFromPixel,
    createSceneRenderer,
    flattenObjectLayers,
    flattenTileLayers,
    orderedTilePlacements,
    placementKey,
    removePlacement,
    scenePixelSize,
    upsertPlacement,
} from "../src/canvas/scene-renderer.mjs";

function recordingCanvas() {
    const calls = [];
    const stack = [];
    const context = {
        globalAlpha: 1,
        lineWidth: 1,
        save() {
            stack.push({ globalAlpha: this.globalAlpha, lineWidth: this.lineWidth });
        },
        restore() {
            Object.assign(this, stack.pop());
        },
        clearRect() {},
        translate(x, y) { calls.push({ type: "translate", x, y }); },
        beginPath() {},
        moveTo() { calls.push({ type: "diamond" }); },
        lineTo() {},
        closePath() {},
        arc() { calls.push({ type: "circle" }); },
        fillText(text) { calls.push({ type: "text", text }); },
        fill() { calls.push({ type: "fill", alpha: this.globalAlpha }); },
        stroke() { calls.push({ type: "stroke", lineWidth: this.lineWidth }); },
    };
    return {
        canvas: {
            width: 0,
            height: 0,
            getContext: () => context,
            addEventListener() {},
            removeEventListener() {},
        },
        calls,
    };
}

test("flattens ordered tile layers with inherited rendering properties", () => {
    const layers = [
        { id: "top", type: "tile", order: 2, visible: true, opacity: 1, hOffset: 1, zOffset: 2 },
        {
            id: "group",
            type: "group",
            order: 1,
            visible: false,
            opacity: 0.5,
            hOffset: 10,
            zOffset: -4,
            layers: [
                { id: "second", type: "tile", order: 4, visible: true, opacity: 0.8, hOffset: 2, zOffset: 3 },
                { id: "first", type: "tile", order: 1, visible: true, opacity: 0.25, hOffset: -1, zOffset: 2 },
            ],
        },
    ];

    const flattened = flattenTileLayers(layers);
    assert.deepEqual(flattened.map(layer => layer.id), ["first", "second", "top"]);
    assert.deepEqual(
        flattened.map(({ visible, opacity, hOffset, zOffset }) => ({ visible, opacity, hOffset, zOffset })),
        [
            { visible: false, opacity: 0.125, hOffset: 9, zOffset: -2 },
            { visible: false, opacity: 0.4, hOffset: 12, zOffset: -1 },
            { visible: true, opacity: 1, hOffset: 1, zOffset: 2 },
        ]
    );
});

test("flattens object layers with inherited rendering properties", () => {
    const layers = [{
        id: "group",
        type: "group",
        visible: false,
        opacity: 0.5,
        hOffset: 7,
        zOffset: -2,
        layers: [
            { id: "tiles", type: "tile", order: 1 },
            { id: "hidden", type: "object", order: 3, visible: false, opacity: 0.8, hOffset: 2, zOffset: 4 },
            { id: "objects", type: "object", order: 2, visible: true, opacity: 0.25, hOffset: -1, zOffset: 3 },
        ],
    }];

    const flattened = flattenObjectLayers(layers);
    assert.deepEqual(flattened.map(layer => layer.id), ["objects", "hidden"]);
    assert.deepEqual(
        flattened.map(({ visible, opacity, hOffset, zOffset }) => ({ visible, opacity, hOffset, zOffset })),
        [
            { visible: false, opacity: 0.125, hOffset: 6, zOffset: 1 },
            { visible: false, opacity: 0.4, hOffset: 9, zOffset: 2 },
        ]
    );
});

test("orders isometric placements by layer, depth, and horizontal position", () => {
    const layers = [{
        id: "upper",
        type: "tile",
        order: 2,
        placements: [{ id: "upper", x: 0, y: 0 }],
    }, {
        id: "ground",
        type: "tile",
        order: 1,
        placements: [
            { id: "last", x: 4, y: 3 },
            { id: "middle-right", x: 3, y: 2 },
            { id: "first", x: 1, y: 1 },
            { id: "middle-left", x: 2, y: 2 },
        ],
    }];

    assert.deepEqual(orderedTilePlacements(layers).map(item => item.placement.id), [
        "first", "middle-left", "middle-right", "last", "upper",
    ]);
});

test("draws object and entity markers after tiles with offsets, opacity, and selection", async () => {
    const { canvas, calls } = recordingCanvas();
    const renderer = createSceneRenderer(canvas);
    await renderer.setOptions({
        showGrid: false,
        selectedObjectId: "object-1",
        selectedEntityId: "entity-1",
    });
    await renderer.setState({
        scene: { width: 4, height: 4, gridWidth: 16, gridHeight: 16 },
        tilesets: [],
        metatiles: [],
        layers: [{
            type: "group",
            visible: true,
            opacity: 0.5,
            hOffset: 4,
            zOffset: 2,
            layers: [{
                type: "object",
                visible: true,
                opacity: 0.5,
                hOffset: 1,
                zOffset: 1,
                objects: [
                    { id: "object-1", x: 1, y: 2, visible: true },
                    { id: "hidden-object", x: 0, y: 0, visible: false },
                ],
            }],
        }],
        entities: [
            { id: "entity-1", definition: "player", x: 0, y: 1, visible: true },
            { id: "hidden-entity", x: 0, y: 0, visible: false },
        ],
    });

    assert.deepEqual(calls.filter(call => call.type === "translate"), [
        { type: "translate", x: 29, y: 37 },
        { type: "translate", x: 8, y: 24 },
    ]);
    assert.deepEqual(calls.filter(call => call.type === "circle"), [
        { type: "circle" },
        { type: "circle" },
    ]);
    assert.deepEqual(calls.filter(call => call.type === "text"), [{ type: "text", text: "O" }, { type: "text", text: "P" }]);
    assert.deepEqual(calls.filter(call => call.type === "fill").map(call => call.alpha), [0.25, 1]);
    assert.deepEqual(calls.filter(call => call.type === "stroke").map(call => call.lineWidth), [3, 3]);
});

test("calculates scene pixels and maps pixels to offset cells", () => {
    const state = {
        scene: { width: 5, height: 4, gridWidth: 16, gridHeight: 8, tileWidth: 32, tileHeight: 16 },
    };
    const layer = { hOffset: 5, zOffset: -3 };

    assert.deepEqual(scenePixelSize(state), { width: 80, height: 32 });
    assert.deepEqual(cellFromPixel(state, layer, 21, 11), { x: 1, y: 1 });
    assert.deepEqual(cellFromPixel(state, layer, 5, 3), { x: 0, y: 0 });
    assert.equal(cellFromPixel(state, layer, 4, 3), null);
    assert.equal(cellFromPixel(state, layer, 85, 3), null);
});

test("upserts and removes placements by cell", () => {
    const layer = { placements: [{ metatileId: "old", x: 1, y: 2 }] };
    const replacement = { metatileId: "new", x: 1, y: 2, flipX: true, flipY: false };
    const added = { metatileId: "other", x: 3, y: 4 };

    assert.equal(placementKey(1, 2), "1,2");
    const replaced = upsertPlacement(layer, replacement);
    const updated = upsertPlacement(replaced, added);
    assert.deepEqual(updated.placements, [replacement, added]);
    assert.deepEqual(layer.placements, [{ metatileId: "old", x: 1, y: 2 }]);

    const removed = removePlacement(updated, 1, 2);
    assert.deepEqual(removed.placements, [added]);
    assert.deepEqual(updated.placements, [replacement, added]);
    assert.deepEqual(removePlacement(removed, 9, 9), removed);
});
