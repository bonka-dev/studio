import { BonkaProjectError, loadBonkaProjectWithAdapter, validateProjectDocuments } from "@bonka/core";

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
            directory = await directory.getDirectoryHandle(part);
        }
        return await directory.getFileHandle(fileName, { create });
    } catch(error) {
        throw new BonkaProjectError(`${source}: ${error.message}`);
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

async function writeText(root, relativePath, text) {
    const handle = await fileHandle(root, relativePath, relativePath);
    const writable = await handle.createWritable();
    try {
        await writable.write(text);
        await writable.close();
    } catch(error) {
        await writable.abort();
        throw error;
    }
}

export async function saveBrowserProject(project) {
    validateProjectDocuments(project);
    const writes = [[project.manifestPath, project.manifest]];
    for(const [id, scene] of project.scenes) {
        writes.push([project.resourcePaths.get(`scene:${id}`), scene]);
    }
    for(const [id, tileset] of project.tilesets) {
        writes.push([project.resourcePaths.get(`tileset:${id}`), tileset]);
    }
    const changes = [];
    for(const [relativePath, document] of writes) {
        const handle = await fileHandle(project.rootHandle, relativePath, relativePath);
        changes.push({
            relativePath,
            original: await (await handle.getFile()).text(),
            updated: `${JSON.stringify(document, null, 2)}\n`,
        });
    }

    const published = [];
    try {
        for(const change of changes) {
            await writeText(project.rootHandle, change.relativePath, change.updated);
            published.push(change);
        }
    } catch(error) {
        const rollbackErrors = [];
        for(const change of published.reverse()) {
            try {
                await writeText(project.rootHandle, change.relativePath, change.original);
            } catch(rollbackError) {
                rollbackErrors.push(`${change.relativePath}: ${rollbackError.message}`);
            }
        }
        if(rollbackErrors.length) {
            throw new BonkaProjectError(`${error.message}; rollback failed: ${rollbackErrors.join("; ")}`);
        }
        throw error;
    }
}

export function closeBrowserProject(project) {
    for(const url of project?.sourceUrls?.values() ?? []) {
        URL.revokeObjectURL(url);
    }
}
