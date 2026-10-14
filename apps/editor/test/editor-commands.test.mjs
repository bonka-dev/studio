import assert from "node:assert/strict";
import { test } from "node:test";

import {
    countPlacements,
    createGroup,
    createHistory,
    createObjectLayer,
    createTileLayer,
    findLayer,
    findLayerPath,
    getLayerParent,
    moveLayer,
    removeLayer,
    traverseLayers,
} from "../src/workspace/editor-commands.mjs";

function layer(id, placements = []) {
    return { id, type: "tile", placements };
}

function state(layers = [], nextLayerId = 0) {
    return {
        projectName: "Test",
        scene: { nextLayerId },
        layers,
        tilesets: [{ id: "tiles", image: "blob:test-image" }],
    };
}

test("traverses and finds layers in depth-first order", () => {
    const child = layer("layer-1", [{ x: 0, y: 0 }]);
    const nested = layer("layer-2", [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    const layers = [
        { id: "group-1", type: "group", layers: [child, { id: "group-2", type: "group", layers: [nested] }] },
        layer("layer-3"),
    ];

    assert.deepEqual(traverseLayers(layers).map(item => item.id), [
        "group-1",
        "layer-1",
        "group-2",
        "layer-2",
        "layer-3",
    ]);
    assert.equal(findLayer(layers, "layer-2"), nested);
    assert.equal(findLayer(layers, "missing"), undefined);
    assert.equal(countPlacements(layers), 3);
});

test("removes nested layers without changing the input state", () => {
    const original = state([
        { id: "group-1", type: "group", order: 4, layers: [
            { ...layer("layer-1"), order: 3 },
            { ...layer("layer-2"), order: 8 },
        ] },
        { ...layer("layer-3"), order: 9 },
    ]);

    const result = removeLayer(original, "layer-2");

    assert.deepEqual(traverseLayers(result.layers).map(item => item.id), ["group-1", "layer-1", "layer-3"]);
    assert.deepEqual(result.layers.map(item => item.order), [4, 9]);
    assert.deepEqual(result.layers[0].layers.map(item => item.order), [0]);
    assert.deepEqual(traverseLayers(original.layers).map(item => item.id), [
        "group-1",
        "layer-1",
        "layer-2",
        "layer-3",
    ]);
    assert.deepEqual(original.layers[0].layers.map(item => item.order), [3, 8]);
});

test("creates immutable tile layers with unique lower-kebab IDs", () => {
    const original = state([
        { id: "group-1", type: "group", layers: [layer("layer-4")] },
    ], 4);

    const result = createTileLayer(original, "Ground Tiles");
    const created = result.layers.at(-1);

    assert.equal(created.id, "layer-5");
    assert.match(created.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(created.name, "Ground Tiles");
    assert.equal(created.type, "tile");
    assert.deepEqual(created.placements, []);
    assert.equal(result.scene.nextLayerId, 6);
    assert.equal(original.scene.nextLayerId, 4);
    assert.equal(original.layers.length, 1);
});

test("creates object and group layers with shared unique IDs and normalized root order", () => {
    const original = state([
        { id: "layer-0", type: "group", order: 7, layers: [layer("layer-2")] },
    ], 0);

    const withObject = createObjectLayer(original, "Actors");
    const result = createGroup(withObject, "Gameplay");

    assert.deepEqual(result.layers.map(item => [item.id, item.type, item.order]), [
        ["layer-0", "group", 0],
        ["layer-1", "object", 1],
        ["layer-3", "group", 2],
    ]);
    assert.deepEqual(result.layers[1].placements, []);
    assert.deepEqual(result.layers[1].objects, []);
    assert.deepEqual(result.layers[2].layers, []);
    assert.equal(result.scene.nextLayerId, 4);
    assert.equal(original.scene.nextLayerId, 0);
    assert.equal(original.layers[0].order, 7);
    for(const created of result.layers.slice(1)) {
        assert.match(created.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
});

test("finds nested index paths and layer parents", () => {
    const child = layer("child");
    const nestedGroup = { id: "nested", type: "group", layers: [child] };
    const rootGroup = { id: "root", type: "group", layers: [nestedGroup] };
    const layers = [layer("first"), rootGroup];

    assert.deepEqual(findLayerPath(layers, "child"), [1, 0, 0]);
    assert.equal(getLayerParent(layers, "child"), nestedGroup);
    assert.equal(getLayerParent(layers, "root"), null);
    assert.equal(findLayerPath(layers, "missing"), undefined);
    assert.equal(getLayerParent(layers, "missing"), undefined);
});

test("moves layers into nested groups and normalizes both sibling lists", () => {
    const unchanged = layer("unchanged");
    const untouchedGroup = { id: "untouched-group", type: "group", order: 9, layers: [layer("untouched-child")] };
    const destination = {
        id: "destination",
        type: "group",
        order: 1,
        layers: [{ ...layer("existing"), order: 6 }],
    };
    const original = state([
        { ...layer("moving"), order: 4 },
        destination,
        { ...unchanged, order: 8 },
        untouchedGroup,
    ]);
    const snapshot = structuredClone(original);

    const result = moveLayer(original, "moving", "destination", 0);

    assert.deepEqual(result.layers.map(item => [item.id, item.order]), [
        ["destination", 0],
        ["unchanged", 1],
        ["untouched-group", 2],
    ]);
    assert.deepEqual(result.layers[0].layers.map(item => [item.id, item.order]), [
        ["moving", 0],
        ["existing", 1],
    ]);
    assert.equal(result.layers[2].layers, untouchedGroup.layers);
    assert.deepEqual(original, snapshot);
});

test("reorders within a group and moves a nested layer back to the root", () => {
    const original = state([
        {
            id: "group",
            type: "group",
            order: 0,
            layers: [
                { ...layer("one"), order: 0 },
                { ...layer("two"), order: 1 },
                { ...layer("three"), order: 2 },
            ],
        },
        { ...layer("root-layer"), order: 1 },
    ]);

    const reordered = moveLayer(original, "one", "group", 2);
    const result = moveLayer(reordered, "two", null, 1);

    assert.deepEqual(reordered.layers[0].layers.map(item => [item.id, item.order]), [
        ["two", 0],
        ["three", 1],
        ["one", 2],
    ]);
    assert.deepEqual(result.layers.map(item => [item.id, item.order]), [
        ["group", 0],
        ["two", 1],
        ["root-layer", 2],
    ]);
    assert.deepEqual(result.layers[0].layers.map(item => [item.id, item.order]), [
        ["three", 0],
        ["one", 1],
    ]);
    assert.deepEqual(original.layers[0].layers.map(item => item.id), ["one", "two", "three"]);
});

test("rejects moves that would create a group cycle without changing state", () => {
    const original = state([{
        id: "outer",
        type: "group",
        layers: [{
            id: "inner",
            type: "group",
            layers: [layer("leaf")],
        }],
    }]);

    assert.equal(moveLayer(original, "outer", "outer", 0), original);
    assert.equal(moveLayer(original, "outer", "inner", 0), original);
    assert.equal(moveLayer(original, "outer", "leaf", 0), original);
    assert.equal(moveLayer(original, "missing", null, 0), original);
    assert.deepEqual(original.layers[0].layers[0].layers.map(item => item.id), ["leaf"]);
});

test("history supports undo, redo, and truncates future entries on a branch", () => {
    const history = createHistory(state(), "Open project");
    history.push(state([layer("layer-0")], 1), "Add first layer");
    history.push(state([layer("layer-0"), layer("layer-1")], 2), "Add second layer");

    assert.equal(history.index(), 2);
    assert.equal(history.undo().layers.length, 1);
    assert.equal(history.redo().layers.length, 2);
    assert.equal(history.goTo(0).layers.length, 0);
    assert.equal(history.goTo(2).layers.length, 2);
    history.undo();
    history.push(state([layer("layer-0"), layer("layer-2")], 3), "Branch");

    assert.equal(history.index(), 2);
    assert.deepEqual(history.entries().map(entry => entry.label), ["Open project", "Add first layer", "Branch"]);
    assert.deepEqual(history.redo().layers.map(item => item.id), ["layer-0", "layer-2"]);
});

test("history snapshots are isolated and preserve string URLs", () => {
    const initial = state();
    const history = createHistory(initial);
    initial.projectName = "Changed outside history";

    const snapshot = history.current();
    snapshot.projectName = "Changed snapshot";
    history.entries()[0].state.projectName = "Changed entry";

    assert.equal(history.current().projectName, "Test");
    assert.equal(history.current().tilesets[0].image, "blob:test-image");
});

test("history tracks the saved revision across undo, branches, and reset", () => {
    const history = createHistory(state());
    assert.equal(history.isDirty(), false);

    history.push(state([layer("layer-0")], 1), "Add layer");
    assert.equal(history.isDirty(), true);
    history.markSaved();
    assert.equal(history.isDirty(), false);

    history.push(state([layer("layer-0"), layer("layer-1")], 2), "Add another layer");
    assert.equal(history.isDirty(), true);
    history.undo();
    assert.equal(history.isDirty(), false);
    history.undo();
    assert.equal(history.isDirty(), true);
    history.push(state([layer("layer-2")], 3), "Replace layers");
    assert.equal(history.isDirty(), true);

    history.reset(state(), "New project");
    assert.equal(history.isDirty(), false);
    assert.equal(history.index(), 0);
    assert.deepEqual(history.entries().map(entry => entry.label), ["New project"]);
});
