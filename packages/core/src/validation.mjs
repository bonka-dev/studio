import Ajv from "ajv";

import entitySchema from "@bonka/project-format/schemas/entity-v1.schema.json" with { type: "json" };
import metatileSchema from "@bonka/project-format/schemas/metatile-v1.schema.json" with { type: "json" };
import projectSchema from "@bonka/project-format/schemas/project-v1.schema.json" with { type: "json" };
import sceneSchema from "@bonka/project-format/schemas/scene-v1.schema.json" with { type: "json" };
import spriteSchema from "@bonka/project-format/schemas/sprite-v1.schema.json" with { type: "json" };
import tilesetSchema from "@bonka/project-format/schemas/tileset-v1.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: true });

const validators = Object.freeze({
    project: ajv.compile(projectSchema),
    metatile: ajv.compile(metatileSchema),
    scene: ajv.compile(sceneSchema),
    sprite: ajv.compile(spriteSchema),
    tileset: ajv.compile(tilesetSchema),
    entity: ajv.compile(entitySchema),
});

export class BonkaProjectError extends Error {
    constructor(message, details = []) {
        super(message);
        this.name = "BonkaProjectError";
        this.details = details;
    }
}

function schemaErrorPath(error) {
    if(error.keyword === "required") {
        return `${error.instancePath}/${error.params.missingProperty}`;
    }

    return error.instancePath || "/";
}

export function validateDocument(kind, document, source = kind) {
    const validator = validators[kind];
    if(! validator) {
        throw new BonkaProjectError(`Unknown Bonka document kind: ${kind}`);
    }

    if(validator(document)) {
        return document;
    }

    const details = validator.errors.map(error => ({
        path: `${source}${schemaErrorPath(error)}`,
        message: error.message,
    }));
    const summary = details.map(detail => `${detail.path} ${detail.message}`).join("; ");
    throw new BonkaProjectError(`Invalid ${kind} document: ${summary}`, details);
}

function projectError(path, message) {
    throw new BonkaProjectError(`${path}: ${message}`, [{ path, message }]);
}

function requireResource(resources, id, path, type) {
    const resource = resources.get(id);
    if(! resource) {
        projectError(path, `unknown ${type} '${id}'`);
    }
    return resource;
}

function validateTilesets(tilesets) {
    for(const [tilesetId, tileset] of tilesets) {
        const horizontalPixels = tileset.layout.imageWidth - 2 * tileset.layout.margin + tileset.layout.spacing;
        const verticalPixels = tileset.layout.imageHeight - 2 * tileset.layout.margin + tileset.layout.spacing;
        const expectedColumns = Math.floor(horizontalPixels / (tileset.tileSize.width + tileset.layout.spacing));
        const expectedRows = Math.floor(verticalPixels / (tileset.tileSize.height + tileset.layout.spacing));
        if(expectedColumns !== tileset.layout.columns) {
            projectError(
                `tilesets/${tilesetId}/layout/columns`,
                `expected ${expectedColumns} columns from the declared image and tile layout`
            );
        }
        if(expectedRows < 1 || tileset.layout.tileCount > expectedColumns * expectedRows) {
            projectError(
                `tilesets/${tilesetId}/layout/tileCount`,
                `tile count ${tileset.layout.tileCount} exceeds image capacity ${expectedColumns * expectedRows}`
            );
        }
    }
}

function validateMetatiles(metatiles, tilesets) {
    for(const [metatileId, metatile] of metatiles) {
        const path = `metatiles/${metatileId}`;
        const expectedLength = metatile.columns * metatile.rows;
        if(metatile.tiles.length !== expectedLength) {
            projectError(`${path}/tiles`, `expected ${expectedLength} entries, received ${metatile.tiles.length}`);
        }
        if(metatile.collision.length !== expectedLength) {
            projectError(`${path}/collision`, `expected ${expectedLength} entries, received ${metatile.collision.length}`);
        }
        for(const [index, tile] of metatile.tiles.entries()) {
            if(tile === null) {
                continue;
            }
            const tileset = requireResource(tilesets, tile.tileset, `${path}/tiles/${index}/tileset`, "tileset");
            if(tileset.tileSize.width !== metatile.tileSize.width
                || tileset.tileSize.height !== metatile.tileSize.height) {
                projectError(
                    `${path}/tiles/${index}/tileset`,
                    `tileset '${tileset.id}' tile size ${tileset.tileSize.width}x${tileset.tileSize.height} `
                        + `does not match metatile tile size ${metatile.tileSize.width}x${metatile.tileSize.height}`
                );
            }
            if(tile.tile >= tileset.layout.tileCount) {
                projectError(
                    `${path}/tiles/${index}/tile`,
                    `tile index ${tile.tile} exceeds tile count ${tileset.layout.tileCount}`
                );
            }
        }
    }
}

function validateEntityDefinitions(entities, sprites) {
    for(const [entityId, entity] of entities) {
        const spriteComponent = entity.components.sprite;
        if(! spriteComponent) {
            continue;
        }

        const sprite = requireResource(
            sprites,
            spriteComponent.asset,
            `entities/${entityId}/components/sprite/asset`,
            "sprite"
        );
        if(! Object.hasOwn(sprite.animations, spriteComponent.animation)) {
            projectError(
                `entities/${entityId}/components/sprite/animation`,
                `unknown animation '${spriteComponent.animation}' on sprite '${sprite.id}'`
            );
        }
    }
}

function validateSprites(sprites) {
    for(const [spriteId, sprite] of sprites) {
        for(const [animationId, animation] of Object.entries(sprite.animations)) {
            for(const [index, frame] of animation.frames.entries()) {
                if(frame.index >= sprite.frameCount) {
                    projectError(
                        `sprites/${spriteId}/animations/${animationId}/frames/${index}/index`,
                        `frame index ${frame.index} exceeds frame count ${sprite.frameCount}`
                    );
                }
            }
        }
    }
}

function validateSceneLayers(scene, metatiles) {
    const layerIds = new Set();
    const objectIds = new Set();

    function validateLayer(layer, path) {
        if(layerIds.has(layer.id)) {
            projectError(`${path}/id`, `duplicate layer ID '${layer.id}'`);
        }
        layerIds.add(layer.id);

        if(layer.type === "group") {
            layer.layers.forEach((child, index) => validateLayer(child, `${path}/layers/${index}`));
            return;
        }

        for(const [index, placement] of layer.placements.entries()) {
            const placementPath = `${path}/placements/${index}`;
            if(placement.cell.x >= scene.size.columns || placement.cell.y >= scene.size.rows) {
                projectError(`${placementPath}/cell`, "placement is outside scene bounds");
            }
            const metatile = requireResource(metatiles, placement.metatile, `${placementPath}/metatile`, "metatile");
            const metatileWidth = metatile.columns * metatile.tileSize.width;
            const metatileHeight = metatile.rows * metatile.tileSize.height;
            if(metatileWidth !== scene.tileSize.width) {
                projectError(
                    `${placementPath}/metatile`,
                    `metatile '${metatile.id}' width ${metatileWidth} does not match scene tile width ${scene.tileSize.width}`
                );
            }
            if(metatileHeight !== scene.tileSize.height) {
                projectError(
                    `${placementPath}/metatile`,
                    `metatile '${metatile.id}' height ${metatileHeight} does not match scene tile height ${scene.tileSize.height}`
                );
            }
            for(const tile of metatile.tiles) {
                if(tile !== null && ! scene.tilesets.includes(tile.tileset)) {
                    projectError(
                        `${placementPath}/metatile`,
                        `metatile '${metatile.id}' uses tileset '${tile.tileset}' not declared by the scene`
                    );
                }
            }
        }

        for(const [index, object] of layer.objects.entries()) {
            const objectPath = `${path}/objects/${index}`;
            if(objectIds.has(object.id)) {
                projectError(`${objectPath}/id`, `duplicate object ID '${object.id}'`);
            }
            objectIds.add(object.id);
            if(object.cell.x >= scene.size.columns || object.cell.y >= scene.size.rows) {
                projectError(`${objectPath}/cell`, "object is outside scene bounds");
            }
        }
    }

    scene.layers.forEach((layer, index) => validateLayer(layer, `scenes/${scene.id}/layers/${index}`));
}

function validateScene(scene, tilesets, metatiles, entities) {
    for(const [index, tilesetId] of scene.tilesets.entries()) {
        requireResource(tilesets, tilesetId, `scenes/${scene.id}/tilesets/${index}`, "tileset");
    }

    validateSceneLayers(scene, metatiles);

    const instanceIds = new Set();
    for(const [index, instance] of scene.entities.entries()) {
        const path = `scenes/${scene.id}/entities/${index}`;
        if(instanceIds.has(instance.id)) {
            projectError(`${path}/id`, `duplicate entity instance ID '${instance.id}'`);
        }
        instanceIds.add(instance.id);
        requireResource(entities, instance.definition, `${path}/definition`, "entity definition");
        if(instance.cell.x >= scene.size.columns || instance.cell.y >= scene.size.rows) {
            projectError(`${path}/cell`, "entity instance is outside scene bounds");
        }
    }
}

export function validateProjectGraph(project) {
    requireResource(project.scenes, project.manifest.startScene, "project/startScene", "scene");
    validateTilesets(project.tilesets);
    validateMetatiles(project.metatiles, project.tilesets);
    validateSprites(project.sprites);
    validateEntityDefinitions(project.entities, project.sprites);

    for(const scene of project.scenes.values()) {
        validateScene(scene, project.tilesets, project.metatiles, project.entities);
    }

    return project;
}

export function validateProjectDocuments(project) {
    validateDocument("project", project.manifest, project.manifestPath);
    for(const [group, kind] of [["scenes", "scene"], ["tilesets", "tileset"], ["metatiles", "metatile"], ["sprites", "sprite"], ["entities", "entity"]]) {
        for(const [id, document] of project[group]) {
            validateDocument(kind, document, project.resourcePaths.get(`${kind}:${id}`) ?? `${group}/${id}`);
        }
    }
    return validateProjectGraph(project);
}
