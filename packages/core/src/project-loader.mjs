import { BonkaProjectError, validateDocument, validateProjectGraph } from "./validation.mjs";

const RESOURCE_GROUPS = Object.freeze([
    ["scenes", "scene"],
    ["tilesets", "tileset"],
    ["sprites", "sprite"],
    ["entities", "entity"],
]);

export async function loadBonkaProjectWithAdapter(adapter) {
    const manifest = validateDocument(
        "project",
        await adapter.readJson(adapter.manifestPath, adapter.manifestPath),
        adapter.manifestPath
    );
    const project = {
        manifestPath: adapter.manifestPath,
        rootDir: adapter.rootDir,
        generatedDir: adapter.generatedDir,
        manifest,
        scenes: new Map(),
        tilesets: new Map(),
        sprites: new Map(),
        entities: new Map(),
        resourcePaths: new Map(),
        sourcePaths: new Map(),
    };

    for(const [group, kind] of RESOURCE_GROUPS) {
        for(const [index, resourceName] of manifest.resources[group].entries()) {
            const source = `${adapter.manifestPath}/resources/${group}/${index}`;
            const resourcePath = await adapter.resolveResource(resourceName, source);
            const document = validateDocument(kind, await adapter.readJson(resourcePath, resourceName), resourceName);
            if(project[group].has(document.id)) {
                throw new BonkaProjectError(`${resourceName}/id: duplicate ${kind} ID '${document.id}'`);
            }

            project[group].set(document.id, document);
            project.resourcePaths.set(`${kind}:${document.id}`, resourcePath);
            if(kind === "sprite" || kind === "tileset") {
                const assetPath = await adapter.resolveAsset(resourcePath, document.source, `${resourceName}/source`);
                project.sourcePaths.set(`${kind}:${document.id}`, assetPath);
            }
        }
    }

    return validateProjectGraph(project);
}
