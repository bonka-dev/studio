import Ajv from "ajv";

import entitySchema from "@bonka/project-format/schemas/entity-v1.schema.json" with { type: "json" };
import inputMapSchema from "@bonka/project-format/schemas/input-map-v1.schema.json" with { type: "json" };
import metatileSchema from "@bonka/project-format/schemas/metatile-v1.schema.json" with { type: "json" };
import prefabSchema from "@bonka/project-format/schemas/prefab-v1.schema.json" with { type: "json" };
import projectSchema from "@bonka/project-format/schemas/project-v1.schema.json" with { type: "json" };
import sceneSchema from "@bonka/project-format/schemas/scene-v1.schema.json" with { type: "json" };
import spriteSchema from "@bonka/project-format/schemas/sprite-v1.schema.json" with { type: "json" };
import tilesetSchema from "@bonka/project-format/schemas/tileset-v1.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: true });

const validators = Object.freeze({
    project: ajv.compile(projectSchema),
    metatile: ajv.compile(metatileSchema),
    prefab: ajv.compile(prefabSchema),
    scene: ajv.compile(sceneSchema),
    sprite: ajv.compile(spriteSchema),
    tileset: ajv.compile(tilesetSchema),
    entity: ajv.compile(entitySchema),
    inputMap: ajv.compile(inputMapSchema),
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

function validatePrefabs(prefabs, metatiles) {
    for(const [prefabId, prefab] of prefabs) {
        const path = `prefabs/${prefabId}`;
        const occupiedCells = new Set();
        for(const [index, placement] of prefab.placements.entries()) {
            const placementPath = `${path}/placements/${index}`;
            if(placement.cell.x >= prefab.columns || placement.cell.y >= prefab.rows) {
                projectError(`${placementPath}/cell`, "placement is outside prefab bounds");
            }
            const cell = `${placement.cell.x}:${placement.cell.y}`;
            if(occupiedCells.has(cell)) {
                projectError(`${placementPath}/cell`, "duplicate prefab placement cell");
            }
            occupiedCells.add(cell);
            requireResource(metatiles, placement.metatile, `${placementPath}/metatile`, "metatile");
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
        if(spriteComponent.animation && ! Object.hasOwn(sprite.animations, spriteComponent.animation)) {
            projectError(
                `entities/${entityId}/components/sprite/animation`,
                `unknown animation '${spriteComponent.animation}' on sprite '${sprite.id}'`
            );
        }
        if(spriteComponent.directionalSet && ! sprite.directionalSets?.some(set => set.id === spriteComponent.directionalSet)) {
            projectError(
                `entities/${entityId}/components/sprite/directionalSet`,
                `unknown directional set '${spriteComponent.directionalSet}' on sprite '${sprite.id}'`
            );
        }
    }
}

function validateInputMaps(inputMaps) {
    for(const [inputMapId, inputMap] of inputMaps) {
        if(inputMap.actions.length > 32) {
            projectError(`inputMaps/${inputMapId}/actions`, "input maps support at most 32 actions");
        }
        const actionIds = new Set();
        for(const [index, action] of inputMap.actions.entries()) {
            if(actionIds.has(action.id)) {
                projectError(`inputMaps/${inputMapId}/actions/${index}/id`, `duplicate input action ID '${action.id}'`);
            }
            actionIds.add(action.id);
        }
    }
}

function validateEntityInputActions(entities, selectedInputMap) {
    if(! selectedInputMap) {
        return;
    }
    const actionIds = new Set(selectedInputMap.actions.map(action => action.id));
    for(const [entityId, entity] of entities) {
        for(const [index, actionId] of (entity.components.behavior?.inputActions ?? []).entries()) {
            if(! actionIds.has(actionId)) {
                projectError(
                    `entities/${entityId}/components/behavior/inputActions/${index}`,
                    `unknown input action '${actionId}' in selected input map '${selectedInputMap.id}'`
                );
            }
        }
    }
}

function validateSprites(sprites) {
    for(const [spriteId, sprite] of sprites) {
        function validateLayout(layout, path, frameCount) {
            if(! layout) return;
            const { imageWidth, imageHeight, columns, rows, margin, spacing } = layout;
            const frameWidth = margin.x + (columns - 1) * (sprite.frameSize.width + spacing.x) + sprite.frameSize.width;
            const frameHeight = margin.y + (rows - 1) * (sprite.frameSize.height + spacing.y) + sprite.frameSize.height;
            if(frameWidth > imageWidth || frameHeight > imageHeight) {
                projectError(
                    path,
                    `grid requires ${frameWidth}x${frameHeight} pixels, exceeding declared image size ${imageWidth}x${imageHeight}`
                );
            }
            if(frameCount > columns * rows) {
                projectError(
                    path,
                    `frame count ${frameCount} exceeds layout capacity ${columns * rows}`
                );
            }
        }
        validateLayout(sprite.layout, `sprites/${spriteId}/layout`, sprite.frameCount);
        if(sprite.authoring) {
            const { width, height, layers } = sprite.authoring;
            const expectedPixels = width * height;
            if(sprite.layout && (width !== sprite.layout.imageWidth || height !== sprite.layout.imageHeight)) {
                projectError(`sprites/${spriteId}/authoring`, "dimensions must match the sprite layout image size");
            }
            const layerIds = new Set();
            for(const [index, layer] of layers.entries()) {
                if(layerIds.has(layer.id)) {
                    projectError(`sprites/${spriteId}/authoring/layers/${index}/id`, `duplicate layer ID '${layer.id}'`);
                }
                layerIds.add(layer.id);
                const layerPixels = (layer.width ?? width) * (layer.height ?? height);
                if(layer.kind === "drawing" && layerPixels !== expectedPixels) {
                    projectError(`sprites/${spriteId}/authoring/layers/${index}/pixels`, `drawing layers must use the authoring dimensions ${width}x${height}`);
                }
                if(layer.pixels.length !== layerPixels) {
                    projectError(`sprites/${spriteId}/authoring/layers/${index}/pixels`, `must contain exactly ${layerPixels} pixels`);
                }
            }
        }
        for(const [animationId, animation] of Object.entries(sprite.animations)) {
            const animationCapacity = animation.layout ? animation.layout.columns * animation.layout.rows : sprite.frameCount;
            validateLayout(animation.layout, `sprites/${spriteId}/animations/${animationId}/layout`, animation.frames.length);
            for(const [index, frame] of animation.frames.entries()) {
                if(frame.index >= animationCapacity) {
                    projectError(
                        `sprites/${spriteId}/animations/${animationId}/frames/${index}/index`,
                        `frame index ${frame.index} exceeds frame count ${animationCapacity}`
                    );
                }
            }
        }
        const directionalSetIds = new Set();
        for(const [setIndex, set] of (sprite.directionalSets ?? []).entries()) {
            const setPath = `sprites/${spriteId}/directionalSets/${setIndex}`;
            if(directionalSetIds.has(set.id)) {
                projectError(`${setPath}/id`, `duplicate directional set ID '${set.id}'`);
            }
            directionalSetIds.add(set.id);
            const angles = new Set();
            for(const [variantIndex, variant] of set.variants.entries()) {
                const variantPath = `${setPath}/variants/${variantIndex}`;
                if(! Object.hasOwn(sprite.animations, variant.animation)) {
                    projectError(`${variantPath}/animation`, `unknown animation '${variant.animation}'`);
                }
                if(angles.has(variant.angle)) {
                    projectError(`${variantPath}/angle`, `duplicate directional variant angle ${variant.angle}`);
                }
                angles.add(variant.angle);
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
    let selectedInputMap;
    if(project.manifest.inputMap !== undefined) {
        selectedInputMap = requireResource(project.inputMaps ?? new Map(), project.manifest.inputMap, "project/inputMap", "input map");
    }
    validateTilesets(project.tilesets);
    validateMetatiles(project.metatiles, project.tilesets);
    validatePrefabs(project.prefabs ?? new Map(), project.metatiles);
    validateSprites(project.sprites);
    validateEntityDefinitions(project.entities, project.sprites);
    validateInputMaps(project.inputMaps ?? new Map());
    validateEntityInputActions(project.entities, selectedInputMap);

    for(const scene of project.scenes.values()) {
        validateScene(scene, project.tilesets, project.metatiles, project.entities);
    }

    return project;
}

export function validateProjectDocuments(project) {
    validateDocument("project", project.manifest, project.manifestPath);
    for(const [group, kind] of [["scenes", "scene"], ["tilesets", "tileset"], ["metatiles", "metatile"], ["prefabs", "prefab"], ["sprites", "sprite"], ["entities", "entity"], ["inputMaps", "inputMap"]]) {
        for(const [id, document] of project[group]) {
            validateDocument(kind, document, project.resourcePaths.get(`${kind}:${id}`) ?? `${group}/${id}`);
        }
    }
    return validateProjectGraph(project);
}
