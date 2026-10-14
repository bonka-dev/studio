import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PNG } from "pngjs";
import { decode } from "@nktkas/bmp";

import { generateGbaProject } from "../src/index.mjs";

async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function temporaryProject(callback) {
    const root = await mkdtemp(path.join(os.tmpdir(), "bonka-target-gba-"));
    try {
        await callback(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function createProject(root) {
    await writeJson(path.join(root, "bonka.config.json"), {
        formatVersion: 1,
        name: "Generator Fixture",
        engine: "butano",
        startScene: "sample-scene",
        resources: {
            scenes: ["scenes/sample.scene.json"],
            tilesets: ["tilesets/red.tileset.json", "tilesets/blue.tileset.json"],
            metatiles: ["metatiles/mixed.metatile.json", "metatiles/hidden.metatile.json"],
            sprites: [],
            entities: [],
        },
    });
    await writeJson(path.join(root, "scenes", "sample.scene.json"), {
        formatVersion: 1,
        type: "scene",
        id: "sample-scene",
        name: "Sample Scene",
        orientation: "isometric",
        size: { columns: 32, rows: 64 },
        grid: { width: 16, height: 8 },
        collisionGrid: { width: 16, height: 8 },
        tileSize: { width: 32, height: 32 },
        tilesets: ["red-tileset", "blue-tileset"],
        layers: [{
            id: "ground-layer",
            type: "tile",
            name: "Ground",
            visible: true,
            opacity: 0.5,
            order: 0,
            offset: { x: 0, y: 0 },
            placements: [{
                metatile: "mixed-metatile",
                cell: { x: 0, y: 0 },
            }, {
                metatile: "mixed-metatile",
                cell: { x: 4, y: 8 },
                flip: { x: true, y: true },
            }, {
                metatile: "mixed-metatile",
                cell: { x: 16, y: 0 },
            }, {
                metatile: "mixed-metatile",
                cell: { x: 0, y: 32 },
            }, {
                metatile: "mixed-metatile",
                cell: { x: 16, y: 32 },
            }, {
                metatile: "hidden-metatile",
                cell: { x: 1, y: 0 },
            }],
            objects: [],
        }],
        entities: [],
    });
    await writeJson(path.join(root, "tilesets", "red.tileset.json"), {
        formatVersion: 1,
        type: "tileset",
        id: "red-tileset",
        name: "Red Tileset",
        source: "red.png",
        tileSize: { width: 8, height: 8 },
        layout: {
            imageWidth: 16,
            imageHeight: 8,
            columns: 2,
            tileCount: 2,
            margin: 0,
            spacing: 0,
        },
    });
    await writeJson(path.join(root, "tilesets", "blue.tileset.json"), {
        formatVersion: 1,
        type: "tileset",
        id: "blue-tileset",
        name: "Blue Tileset",
        source: "blue.png",
        tileSize: { width: 8, height: 8 },
        layout: {
            imageWidth: 8,
            imageHeight: 8,
            columns: 1,
            tileCount: 1,
            margin: 0,
            spacing: 0,
        },
    });
    await writeJson(path.join(root, "metatiles", "mixed.metatile.json"), {
        formatVersion: 1,
        type: "metatile",
        id: "mixed-metatile",
        name: "Mixed Metatile",
        tileSize: { width: 8, height: 8 },
        columns: 4,
        rows: 4,
        visible: true,
        opacity: 0.5,
        tiles: [
            { tileset: "red-tileset", tile: 1 },
            { tileset: "blue-tileset", tile: 0 },
            { tileset: "red-tileset", tile: 0 },
            null,
            { tileset: "blue-tileset", tile: 0 },
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
        ],
        collision: Array(16).fill(0),
    });
    await writeJson(path.join(root, "metatiles", "hidden.metatile.json"), {
        formatVersion: 1,
        type: "metatile",
        id: "hidden-metatile",
        name: "Hidden Metatile",
        tileSize: { width: 8, height: 8 },
        columns: 4,
        rows: 4,
        visible: false,
        opacity: 1,
        tiles: [{ tileset: "blue-tileset", tile: 0 }, ...Array(15).fill(null)],
        collision: Array(16).fill(0),
    });

    const red = new PNG({ width: 16, height: 8 });
    for(let y = 0; y < red.height; ++y) {
        for(let x = 0; x < red.width; ++x) {
            const index = (y * red.width + x) * 4;
            red.data[index] = 255;
            red.data[index + 3] = 255;
        }
    }
    const marker = (0 * red.width + 8) * 4;
    red.data[marker + 1] = 255;
    await writeFile(path.join(root, "tilesets", "red.png"), PNG.sync.write(red));

    const blue = new PNG({ width: 8, height: 8 });
    for(let index = 0; index < blue.data.length; index += 4) {
        blue.data[index + 2] = 255;
        blue.data[index + 3] = 255;
    }
    await writeFile(path.join(root, "tilesets", "blue.png"), PNG.sync.write(blue));
}

function pixel(image, x, y) {
    const index = (y * image.width + x) * image.channels;
    return [...image.data.subarray(index, index + 3)];
}

function mapCells(header) {
    return [...header.matchAll(/0x([0-9a-f]{4})/g)].map(([, cell]) => Number.parseInt(cell, 16));
}

function mapPixel(tileBank, cells, mapColumns, x, y) {
    const cellX = Math.floor(x / 8);
    const cellY = Math.floor(y / 8);
    const blocksPerRow = mapColumns / 32;
    const block = Math.floor(cellY / 32) * blocksPerRow + Math.floor(cellX / 32);
    const cell = cells[block * 1024 + cellY % 32 * 32 + cellX % 32];
    const tile = cell & 0x03ff;
    const tilesPerRow = tileBank.width / 8;
    const localX = cell & 1 << 10 ? 7 - x % 8 : x % 8;
    const localY = cell & 1 << 11 ? 7 - y % 8 : y % 8;
    return pixel(tileBank, tile % tilesPerRow * 8 + localX, Math.floor(tile / tilesPerRow) * 8 + localY);
}

test("generates disposable Butano inputs from a Project Format v1 project", async() => {
    await temporaryProject(async root => {
        await createProject(root);
        const manifestPath = path.join(root, "bonka.config.json");
        const first = await generateGbaProject(manifestPath);

        assert.deepEqual(first.files, [
            "generated.mk",
            "graphics/bonka_scene_sample_scene.bmp",
            "graphics/bonka_scene_sample_scene.json",
            "include/bonka_scene_sample_scene.h",
            "include/bonka_scene_sample_scene_map.h",
            "include/bonka_start_scene.h",
        ]);
        const output = await readFile(path.join(root, ".bonka", "graphics", "bonka_scene_sample_scene.bmp"));
        assert.equal(output.toString("ascii", 0, 2), "BM");
        assert.equal(output.readUInt32LE(18), 32);
        assert.equal(output.readUInt32LE(22), 8);
        const image = decode(output);
        assert.deepEqual(pixel(image, 0, 0), [0, 0, 0]);
        assert.deepEqual(pixel(image, 8, 0), [64, 64, 0]);
        assert.deepEqual(pixel(image, 9, 0), [64, 0, 0]);
        assert.deepEqual(pixel(image, 15, 0), [64, 0, 0]);
        assert.deepEqual(pixel(image, 16, 0), [0, 0, 64]);
        assert.deepEqual(pixel(image, 24, 0), [64, 0, 0]);
        const graphicsConfig = await readFile(path.join(root, ".bonka", "graphics", "bonka_scene_sample_scene.json"), "utf8");
        assert.match(graphicsConfig, /"regular_bg_tiles"/);
        assert.match(graphicsConfig, /"generate_palette": true/);

        const generatedMakefile = await readFile(path.join(root, ".bonka", "generated.mk"), "utf8");
        assert.match(generatedMakefile, /tilesets\/red\.png/);
        assert.match(generatedMakefile, /tilesets\/blue\.png/);
        assert.match(generatedMakefile, /metatiles\/mixed\.metatile\.json/);
        assert.match(generatedMakefile, /metatiles\/hidden\.metatile\.json/);
        assert.deepEqual(await readdir(path.join(root, ".bonka", "graphics")), [
            "bonka_scene_sample_scene.bmp",
            "bonka_scene_sample_scene.json",
        ]);
        assert.match(await readFile(path.join(root, ".bonka", "include", "bonka_scene_sample_scene.h"), "utf8"), /CELLS_X = 32/);
        const sceneMapHeader = await readFile(path.join(root, ".bonka", "include", "bonka_scene_sample_scene_map.h"), "utf8");
        const cells = mapCells(sceneMapHeader);
        assert.equal(cells.length, 64 * 64);
        assert.deepEqual(cells.slice(0, 3), [1, 2, 3]);
        assert.equal(cells[32], 2);
        assert.equal(cells[11 * 32 + 11], 1 | 1 << 10 | 1 << 11);
        assert.deepEqual(cells.slice(1024, 1027), [1, 2, 3]);
        assert.deepEqual(cells.slice(2048, 2051), [1, 2, 3]);
        assert.deepEqual(cells.slice(3072, 3075), [1, 2, 3]);
        assert.deepEqual(mapPixel(image, cells, 32, 0, 0), [64, 64, 0]);
        assert.deepEqual(mapPixel(image, cells, 32, 1, 0), [64, 0, 0]);
        assert.deepEqual(mapPixel(image, cells, 32, 8, 0), [0, 0, 64]);
        assert.deepEqual(mapPixel(image, cells, 32, 16, 0), [64, 0, 0]);
        assert.deepEqual(mapPixel(image, cells, 32, 64, 64), [0, 0, 0]);
        assert.deepEqual(mapPixel(image, cells, 32, 88, 80), [0, 0, 64]);
        assert.deepEqual(mapPixel(image, cells, 32, 72, 88), [64, 0, 0]);
        assert.deepEqual(mapPixel(image, cells, 32, 80, 88), [0, 0, 64]);
        assert.deepEqual(mapPixel(image, cells, 32, 95, 95), [64, 64, 0]);
        const startSceneHeader = await readFile(path.join(root, ".bonka", "include", "bonka_start_scene.h"), "utf8");
        assert.match(startSceneHeader, /regular_bg_item start_scene_background\(/);
        assert.match(startSceneHeader, /regular_bg_tiles_items::bonka_scene_sample_scene/);
        assert.match(startSceneHeader, /start_scene_pixels_x = 512/);
        assert.match(startSceneHeader, /start_scene_pixels_y = 512/);
        assert.match(startSceneHeader, /start_scene_background_center_x = 0/);
        assert.match(startSceneHeader, /start_scene_background_center_y = 0/);

        await writeFile(path.join(root, ".bonka", "stale.txt"), "stale\n");
        await generateGbaProject(manifestPath);
        await assert.rejects(access(path.join(root, ".bonka", "stale.txt")));
    });
});
