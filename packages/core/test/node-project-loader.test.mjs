import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadBonkaProject } from "../src/node-project-loader.mjs";

const fixtureManifest = fileURLToPath(
    new URL("./fixtures/valid-project/bonka.config.json", import.meta.url)
);

test("loads a self-contained Project Format v1 fixture", async() => {
    const project = await loadBonkaProject(fixtureManifest);

    assert.equal(project.manifest.startScene, "sample-scene");
    assert.deepEqual([...project.scenes.keys()], ["sample-scene"]);
    assert.deepEqual([...project.tilesets.keys()], ["sample-tileset"]);
    assert.deepEqual([...project.metatiles.keys()], ["sample-metatile"]);
    assert.deepEqual([...project.sprites.keys()], ["sample-sprite"]);
    assert.deepEqual([...project.entities.keys()], ["sample-entity"]);
    assert.match(project.sourcePaths.get("tileset:sample-tileset"), /tileset\.svg$/);
    assert.match(project.resourcePaths.get("metatile:sample-metatile"), /sample\.metatile\.json$/);
    assert.match(project.sourcePaths.get("sprite:sample-sprite"), /sprite\.svg$/);
});
