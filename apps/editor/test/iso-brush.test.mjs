import assert from "node:assert/strict";
import { test } from "node:test";

import { interpolateIsoBrushCells, nearestIsoBrushCell, snapBrushCell } from "../src/canvas/iso-brush.mjs";

const scene = { width: 32, height: 32, gridWidth: 16, gridHeight: 8, tileWidth: 32, tileHeight: 32 };
const layer = { hOffset: 0, zOffset: 0 };

test("snaps pointer positions around the visual center to the nearest grid cell", () => {
    assert.deepEqual(snapBrushCell({ x: 16, y: 16 }, layer, scene), { x: 0, y: 0 });
    assert.deepEqual(snapBrushCell({ x: 39, y: 27 }, layer, scene), { x: 1, y: 1 });
    assert.deepEqual(snapBrushCell({ x: 40, y: 28 }, layer, scene), { x: 2, y: 2 });
});

test("finds nearest cells on both diagonal isometric brush axes", () => {
    const anchor = { x: 8, y: 8 };
    assert.deepEqual(nearestIsoBrushCell({ x: 208, y: 112 }, anchor, layer, scene, 1), { x: 12, y: 12 });
    assert.deepEqual(nearestIsoBrushCell({ x: 208, y: 48 }, anchor, layer, scene, 1), { x: 12, y: 4 });
});

test("interpolates contiguous strokes in isometric coordinates", () => {
    const anchor = { x: 8, y: 8 };
    assert.deepEqual(interpolateIsoBrushCells(anchor, { x: 12, y: 12 }, anchor, 1), [
        { x: 9, y: 9 }, { x: 10, y: 10 }, { x: 11, y: 11 }, { x: 12, y: 12 },
    ]);
    assert.deepEqual(interpolateIsoBrushCells(anchor, { x: 12, y: 4 }, anchor, 1), [
        { x: 9, y: 7 }, { x: 10, y: 6 }, { x: 11, y: 5 }, { x: 12, y: 4 },
    ]);
    assert.deepEqual(interpolateIsoBrushCells(anchor, { x: 12, y: 8 }, anchor, 1), [
        { x: 10, y: 8 }, { x: 12, y: 8 },
    ]);
});
