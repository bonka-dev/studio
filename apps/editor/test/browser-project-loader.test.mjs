import assert from "node:assert/strict";
import { test } from "node:test";

import {
    addEntityDefinition,
    addEntityInstance,
    addMetatile,
    applyEditorState,
    ensureTileLayer,
    projectToEditorState,
} from "../src/project/editor-project.mjs";
import {
    closeBrowserProject,
    createBrowserProject,
    importPngTilesets,
    saveBrowserProject,
} from "../src/io/browser-project-loader.mjs";

function notFound() {
    return new DOMException("Not found", "NotFoundError");
}

function bytes(value) {
    if(typeof value === "string") return new TextEncoder().encode(value);
    if(value instanceof Uint8Array) return value.slice();
    if(value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    throw new TypeError("Unsupported mock file data");
}

class MemoryFileHandle {
    constructor(root, path, initial = new Uint8Array()) {
        this.root = root;
        this.path = path;
        this.data = bytes(initial);
    }

    async getFile() {
        const data = this.data.slice();
        return {
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            text: async () => new TextDecoder().decode(data),
        };
    }

    async createWritable() {
        let next;
        return {
            write: async value => {
                if(this.root.failPath === this.path) {
                    this.root.failPath = null;
                    throw new Error("mock write failure");
                }
                next = bytes(value);
            },
            close: async () => { this.data = next; },
            abort: async () => {},
        };
    }
}

class MemoryDirectoryHandle {
    constructor(root = null, path = "") {
        this.root = root ?? this;
        this.path = path;
        this.directories = new Map();
        this.files = new Map();
        this.failPath = null;
    }

    async getDirectoryHandle(name, { create = false } = {}) {
        if(! this.directories.has(name)) {
            if(! create) throw notFound();
            const path = this.path ? `${this.path}/${name}` : name;
            this.directories.set(name, new MemoryDirectoryHandle(this.root, path));
        }
        return this.directories.get(name);
    }

    async getFileHandle(name, { create = false } = {}) {
        if(! this.files.has(name)) {
            if(! create) throw notFound();
            const path = this.path ? `${this.path}/${name}` : name;
            this.files.set(name, new MemoryFileHandle(this.root, path));
        }
        return this.files.get(name);
    }

    async removeEntry(name) {
        if(! this.files.delete(name)) throw notFound();
    }

    async read(path) {
        const parts = path.split("/");
        const name = parts.pop();
        let directory = this;
        for(const part of parts) directory = await directory.getDirectoryHandle(part);
        return (await directory.getFileHandle(name)).getFile();
    }
}

function png(width, height, name = "Grass.PNG") {
    const data = new Uint8Array(24);
    data.set([137, 80, 78, 71, 13, 10, 26, 10]);
    data.set([73, 72, 68, 82], 12);
    const view = new DataView(data.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    const file = new Blob([data], { type: "image/png" });
    Object.defineProperty(file, "name", { value: name });
    return file;
}

test("imports PNGs as standalone tilesets and persists new binary and JSON resources", async () => {
    const root = new MemoryDirectoryHandle();
    const project = await createBrowserProject(root, { name: "Browser Test" });
    const entity = addEntityDefinition(project, { id: "moving-platform" });
    const imported = await importPngTilesets(project, [png(32, 32), png(16, 8, "Grass.png")], {
        tileWidth: 8,
        tileHeight: 8,
    });
    addMetatile(project, {
        name: "Ground",
        columns: 4,
        rows: 4,
        tiles: [
            { tileset: imported[0].id, tile: 0 },
            ...Array(15).fill(null),
        ],
    });
    const state = projectToEditorState(project, project.sourceUrls);
    addEntityInstance(state, { definition: entity.id, x: 3, y: 4 });
    assert.deepEqual(
        { width: state.metatiles[0].tileWidth, height: state.metatiles[0].tileHeight },
        { width: 8, height: 8 }
    );
    ensureTileLayer(state).placements.push({
        metatileId: "ground",
        x: 1,
        y: 2,
        flipX: false,
        flipY: false,
        sourceHasFlip: false,
    });
    applyEditorState(project, state);

    await saveBrowserProject(project);

    const tileset = JSON.parse(await (await root.read("assets/tilesets/grass.tileset.json")).text());
    const manifest = JSON.parse(await (await root.read("bonka.config.json")).text());
    const scene = JSON.parse(await (await root.read("scenes/scene-1.scene.json")).text());
    const metatile = JSON.parse(await (await root.read("metatiles/ground.metatile.json")).text());
    const entityDocument = JSON.parse(await (await root.read("entities/moving-platform.entity.json")).text());
    assert.equal(tileset.layout.columns, 4);
    assert.equal(tileset.layout.tileCount, 16);
    assert.equal(Object.hasOwn(tileset, "metatiles"), false);
    assert.deepEqual(manifest.resources.metatiles, ["metatiles/ground.metatile.json"]);
    assert.deepEqual(manifest.resources.tilesets, [
        "assets/tilesets/grass.tileset.json",
        "assets/tilesets/grass-2.tileset.json",
    ]);
    assert.deepEqual(manifest.resources.entities, ["entities/moving-platform.entity.json"]);
    assert.equal((await (await root.read("assets/tilesets/grass.png")).arrayBuffer()).byteLength, 24);
    assert.equal((await (await root.read("assets/tilesets/grass-2.png")).arrayBuffer()).byteLength, 24);
    assert.deepEqual(scene.layers[0].placements[0], { metatile: "ground", cell: { x: 1, y: 2 } });
    assert.deepEqual(scene.entities, [{
        id: "moving-platform-001",
        definition: "moving-platform",
        cell: { x: 3, y: 4 },
    }]);
    assert.deepEqual(entityDocument.components, {
        collider: { shape: "box", width: 1, height: 1 },
    });
    assert.deepEqual(metatile.tileSize, { width: 8, height: 8 });
    closeBrowserProject(project);
});

test("rolls back newly published files when a later save write fails", async () => {
    const root = new MemoryDirectoryHandle();
    const project = await createBrowserProject(root, { name: "Rollback Test" });
    await importPngTilesets(project, [png(32, 32)]);
    root.failPath = "assets/tilesets/grass.tileset.json";

    await assert.rejects(saveBrowserProject(project), /mock write failure/);
    await assert.rejects(root.read("assets/tilesets/grass.png"), error => error.name === "NotFoundError");
    await assert.rejects(root.read("assets/tilesets/grass.tileset.json"), error => error.name === "NotFoundError");
    const manifest = JSON.parse(await (await root.read("bonka.config.json")).text());
    assert.deepEqual(manifest.resources.tilesets, []);
    closeBrowserProject(project);
});
