import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { BonkaProjectError } from "./validation.mjs";
import { loadBonkaProjectWithAdapter } from "./project-loader.mjs";

function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (! relative.startsWith(`..${path.sep}`) && relative !== ".." && ! path.isAbsolute(relative));
}

function ensurePortableRelativePath(value, source) {
    if(path.isAbsolute(value) || value.includes("\\")) {
        throw new BonkaProjectError(`${source}: paths must be relative and use '/' separators`);
    }
}

async function resolveExistingContainedPath(root, baseDir, value, source) {
    ensurePortableRelativePath(value, source);
    const candidate = path.resolve(baseDir, value);
    if(! isInside(root, candidate)) {
        throw new BonkaProjectError(`${source}: path escapes the project root`);
    }

    let resolved;
    try {
        resolved = await realpath(candidate);
    } catch(error) {
        throw new BonkaProjectError(`${source}: ${error.message}`);
    }
    if(! isInside(root, resolved)) {
        throw new BonkaProjectError(`${source}: resolved path escapes the project root`);
    }
    let entry;
    try {
        entry = await stat(resolved);
    } catch(error) {
        throw new BonkaProjectError(`${source}: ${error.message}`);
    }
    if(! entry.isFile()) {
        throw new BonkaProjectError(`${source}: path must reference a regular file`);
    }
    return resolved;
}

async function resolveGeneratedDir(root) {
    const candidate = path.join(root, ".bonka");
    try {
        const entry = await lstat(candidate);
        if(entry.isSymbolicLink()) {
            throw new BonkaProjectError(`${candidate}: generated directory must not be a symbolic link or junction`);
        }
        if(! entry.isDirectory()) {
            throw new BonkaProjectError(`${candidate}: generated path must be a directory`);
        }

        const resolved = await realpath(candidate);
        if(path.resolve(resolved) !== path.resolve(candidate)) {
            throw new BonkaProjectError(`${candidate}: generated directory must not redirect elsewhere`);
        }
    } catch(error) {
        if(error instanceof BonkaProjectError) {
            throw error;
        }
        if(error.code !== "ENOENT") {
            throw new BonkaProjectError(`${candidate}: ${error.message}`);
        }
    }
    return candidate;
}

async function readJson(filePath, source) {
    let text;
    try {
        text = await readFile(filePath, "utf8");
    } catch(error) {
        throw new BonkaProjectError(`${source}: ${error.message}`);
    }

    try {
        return JSON.parse(text);
    } catch(error) {
        throw new BonkaProjectError(`${source}: invalid JSON: ${error.message}`);
    }
}

export async function loadBonkaProject(manifestFile = "bonka.config.json") {
    let manifestPath;
    try {
        manifestPath = await realpath(path.resolve(manifestFile));
    } catch(error) {
        throw new BonkaProjectError(`${manifestFile}: ${error.message}`);
    }

    const rootDir = path.dirname(manifestPath);
    const generatedDir = await resolveGeneratedDir(rootDir);
    return loadBonkaProjectWithAdapter({
        manifestPath,
        rootDir,
        generatedDir,
        readJson,
        resolveResource: (value, source) => resolveExistingContainedPath(rootDir, rootDir, value, source),
        resolveAsset: (resourcePath, value, source) => resolveExistingContainedPath(
            rootDir,
            path.dirname(resourcePath),
            value,
            source
        ),
    });
}
