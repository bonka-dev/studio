import { BonkaProjectError, loadBonkaProjectWithAdapter, validateProjectDocuments } from "@bonka/core";

import { createProjectDocuments } from "../project/editor-project.mjs";
import { createTilesetDocument, readPngDimensions, toResourceId } from "../project/editor-project.mjs";

export function normalizePortablePath(value, source) {
    if(typeof value !== "string" || value.startsWith("/") || value.includes("\\")) {
        throw new BonkaProjectError(`${source}: paths must be relative and use '/' separators`);
    }
    const parts = [];
    for(const part of value.split("/")) {
        if(! part || part === ".") {
            continue;
        }
        if(part === "..") {
            if(! parts.length) {
                throw new BonkaProjectError(`${source}: path escapes the project root`);
            }
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    if(! parts.length) {
        throw new BonkaProjectError(`${source}: path must identify a file`);
    }
    return parts.join("/");
}

function dirname(value) {
    const parts = value.split("/");
    parts.pop();
    return parts.join("/");
}

function join(base, value, source) {
    return normalizePortablePath(base ? `${base}/${value}` : value, source);
}

async function fileHandle(root, relativePath, source, create = false) {
    const parts = normalizePortablePath(relativePath, source).split("/");
    const fileName = parts.pop();
    let directory = root;
    try {
        for(const part of parts) {
            directory = await directory.getDirectoryHandle(part, { create });
        }
        return await directory.getFileHandle(fileName, { create });
    } catch(error) {
        const wrapped = new BonkaProjectError(`${source}: ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
    }
}

async function readJson(root, relativePath, source) {
    const handle = await fileHandle(root, relativePath, source);
    const file = await handle.getFile();
    try {
        return JSON.parse(await file.text());
    } catch(error) {
        throw new BonkaProjectError(`${source}: invalid JSON: ${error.message}`);
    }
}

export async function openBrowserProject(rootHandle) {
    const manifestPath = "bonka.config.json";
    const project = await loadBonkaProjectWithAdapter({
        manifestPath,
        rootDir: "",
        generatedDir: ".bonka",
        readJson: (relativePath, source) => readJson(rootHandle, relativePath, source),
        resolveResource: async (value, source) => {
            const relativePath = normalizePortablePath(value, source);
            await fileHandle(rootHandle, relativePath, source);
            return relativePath;
        },
        resolveAsset: async (resourcePath, value, source) => {
            const relativePath = join(dirname(resourcePath), value, source);
            await fileHandle(rootHandle, relativePath, source);
            return relativePath;
        },
    });

    const sourceUrls = new Map();
    for(const [key, relativePath] of project.sourcePaths) {
        const handle = await fileHandle(rootHandle, relativePath, relativePath);
        sourceUrls.set(key, URL.createObjectURL(await handle.getFile()));
    }
    project.rootHandle = rootHandle;
    project.sourceUrls = sourceUrls;
    return project;
}

async function writeText(root, relativePath, text, create = false) {
    return writeData(root, relativePath, text, create);
}

async function writeData(root, relativePath, data, create = false) {
    const handle = await fileHandle(root, relativePath, relativePath, create);
    const writable = await handle.createWritable();
    try {
        await writable.write(data);
        await writable.close();
    } catch(error) {
        await writable.abort();
        throw error;
    }
}

async function pathExists(root, relativePath) {
    try {
        await fileHandle(root, relativePath, relativePath);
        return true;
    } catch(error) {
        if(error.cause?.name === "NotFoundError" || error.name === "NotFoundError") {
            return false;
        }
        throw error;
    }
}

async function removeFile(root, relativePath) {
    const parts = normalizePortablePath(relativePath, relativePath).split("/");
    const fileName = parts.pop();
    let directory = root;
    for(const part of parts) {
        directory = await directory.getDirectoryHandle(part);
    }
    await directory.removeEntry(fileName);
}

export async function importPngTilesets(project, files, { tileWidth = 8, tileHeight = 8 } = {}) {
    if(! project?.rootHandle) {
        throw new Error("Open or create a project before importing tilesets");
    }
    const imports = [];
    const usedIds = new Set(project.tilesets.keys());
    for(const file of files) {
        if(! file.name.toLowerCase().endsWith(".png") || (file.type && file.type !== "image/png")) {
            throw new Error(`${file.name}: select a PNG image`);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsedDimensions = readPngDimensions(bytes);
        let decodedDimensions = parsedDimensions;
        if(typeof globalThis.createImageBitmap === "function") {
            let bitmap;
            try {
                bitmap = await globalThis.createImageBitmap(file);
                decodedDimensions = { width: bitmap.width, height: bitmap.height };
            } catch(error) {
                throw new Error(`${file.name}: PNG could not be decoded: ${error.message}`);
            } finally {
                bitmap?.close();
            }
        }
        if(decodedDimensions.width !== parsedDimensions.width || decodedDimensions.height !== parsedDimensions.height) {
            throw new Error(`${file.name}: decoded PNG dimensions do not match its header`);
        }
        const { width, height } = decodedDimensions;
        const name = file.name.replace(/\.png$/i, "").trim() || "Tileset";
        const base = toResourceId(name, "tileset");
        let id = base;
        for(let suffix = 2; usedIds.has(id) ||
            await pathExists(project.rootHandle, `assets/tilesets/${id}.tileset.json`) ||
            await pathExists(project.rootHandle, `assets/tilesets/${id}.png`); ++suffix) {
            id = `${base}-${suffix}`;
        }
        usedIds.add(id);
        imports.push({
            document: createTilesetDocument({
                id,
                name,
                imageWidth: width,
                imageHeight: height,
                tileWidth: Number(tileWidth),
                tileHeight: Number(tileHeight),
            }),
            bytes,
            file,
        });
    }

    project.pendingBinaryWrites ??= new Map();
    project.sourceUrls ??= new Map();
    const scene = project.scenes.get(project.manifest.startScene);
    for(const imported of imports) {
        const { id } = imported.document;
        const resourcePath = `assets/tilesets/${id}.tileset.json`;
        const sourcePath = `assets/tilesets/${id}.png`;
        project.tilesets.set(id, imported.document);
        project.resourcePaths.set(`tileset:${id}`, resourcePath);
        project.sourcePaths.set(`tileset:${id}`, sourcePath);
        project.pendingBinaryWrites.set(sourcePath, imported.bytes);
        project.manifest.resources.tilesets.push(resourcePath);
        if(! scene.tilesets.includes(id)) {
            scene.tilesets.push(id);
        }
        if(typeof URL !== "undefined" && URL.createObjectURL) {
            project.sourceUrls.set(`tileset:${id}`, URL.createObjectURL(imported.file));
        }
    }
    return imports.map(imported => imported.document);
}

export async function createBrowserProject(rootHandle, options) {
    try {
        await rootHandle.getFileHandle("bonka.config.json");
        throw new BonkaProjectError("bonka.config.json: a Bonka project already exists in this directory");
    } catch(error) {
        if(error instanceof BonkaProjectError) {
            throw error;
        }
        if(error.name !== "NotFoundError") {
            throw new BonkaProjectError(`bonka.config.json: ${error.message}`);
        }
    }

    const project = createProjectDocuments(options);
    const scene = project.scenes.get(project.manifest.startScene);
    const scenePath = project.resourcePaths.get(`scene:${scene.id}`);
    await writeText(rootHandle, scenePath, `${JSON.stringify(scene, null, 2)}\n`, true);
    await writeText(rootHandle, project.manifestPath, `${JSON.stringify(project.manifest, null, 2)}\n`, true);
    return openBrowserProject(rootHandle);
}

export async function saveBrowserProject(project) {
    validateProjectDocuments(project);
    const writes = [];
    for(const [id, scene] of project.scenes) {
        writes.push([project.resourcePaths.get(`scene:${id}`), scene]);
    }
    for(const [id, tileset] of project.tilesets) {
        writes.push([project.resourcePaths.get(`tileset:${id}`), tileset]);
    }
    for(const [id, metatile] of project.metatiles) {
        writes.push([project.resourcePaths.get(`metatile:${id}`), metatile]);
    }
    for(const [id, sprite] of project.sprites) {
        writes.push([project.resourcePaths.get(`sprite:${id}`), sprite]);
    }
    for(const [id, entity] of project.entities) {
        writes.push([project.resourcePaths.get(`entity:${id}`), entity]);
    }
    writes.push([project.manifestPath, project.manifest]);
    const changes = [];
    for(const [relativePath, bytes] of project.pendingBinaryWrites ?? []) {
        let original = null;
        let existed = false;
        try {
            const handle = await fileHandle(project.rootHandle, relativePath, relativePath);
            original = await (await handle.getFile()).arrayBuffer();
            existed = true;
        } catch(error) {
            if(error.cause?.name !== "NotFoundError" && error.name !== "NotFoundError") {
                throw error;
            }
            // A newly imported asset has no backup.
        }
        changes.push({ relativePath, original, existed, updated: bytes });
    }
    for(const [relativePath, document] of writes) {
        let original = null;
        let existed = false;
        try {
            const handle = await fileHandle(project.rootHandle, relativePath, relativePath);
            original = await (await handle.getFile()).text();
            existed = true;
        } catch(error) {
            if(relativePath === project.manifestPath) {
                throw error;
            }
            if(error.cause?.name !== "NotFoundError" && error.name !== "NotFoundError") {
                throw error;
            }
        }
        changes.push({
            relativePath,
            original,
            existed,
            updated: `${JSON.stringify(document, null, 2)}\n`,
        });
    }
    const published = [];
    try {
        for(const change of changes) {
            published.push(change);
            await writeData(project.rootHandle, change.relativePath, change.updated, ! change.existed);
        }
    } catch(error) {
        const rollbackErrors = [];
        for(const change of published.reverse()) {
            try {
                if(change.existed) {
                    await writeData(project.rootHandle, change.relativePath, change.original);
                } else {
                    await removeFile(project.rootHandle, change.relativePath);
                }
            } catch(rollbackError) {
                rollbackErrors.push(`${change.relativePath}: ${rollbackError.message}`);
            }
        }
        if(rollbackErrors.length) {
            throw new BonkaProjectError(`${error.message}; rollback failed: ${rollbackErrors.join("; ")}`);
        }
        throw error;
    }
    project.pendingBinaryWrites?.clear();
}

export function closeBrowserProject(project) {
    for(const url of project?.sourceUrls?.values() ?? []) {
        URL.revokeObjectURL(url);
    }
}
