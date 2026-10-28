import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

import { BonkaProjectError } from "@bonka/core";
import { loadBonkaProject } from "@bonka/core/node";

const REGULAR_BG_DIMENSIONS = new Set([256, 512]);

function outputName(id) {
    return `bonka_scene_${id.replaceAll("-", "_")}`;
}

function includeGuard(id) {
    return `${outputName(id).toUpperCase()}_H`;
}

function makePath(root, filePath) {
    return path.relative(root, filePath).split(path.sep).join("/").replaceAll(" ", "\\ ");
}

function blend(data, destination, red, green, blue, alpha) {
    if(! alpha) {
        return;
    }

    const destinationAlpha = data[destination + 3];
    const outputAlpha = alpha + Math.round(destinationAlpha * (255 - alpha) / 255);
    data[destination] = Math.round((red * alpha + data[destination] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    data[destination + 1] = Math.round((green * alpha + data[destination + 1] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    data[destination + 2] = Math.round((blue * alpha + data[destination + 2] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    data[destination + 3] = outputAlpha;
}

async function encodeBitmap(image) {
    const data = new Uint8Array(image.width * image.height * 3);
    const palette = [];
    const paletteKeys = new Set();
    for(let pixel = 0; pixel < image.width * image.height; ++pixel) {
        const source = pixel * 4;
        const destination = pixel * 3;
        const alpha = image.data[source + 3];
        const red = Math.round(image.data[source] * alpha / 255);
        const green = Math.round(image.data[source + 1] * alpha / 255);
        const blue = Math.round(image.data[source + 2] * alpha / 255);
        data[destination] = red;
        data[destination + 1] = green;
        data[destination + 2] = blue;
        const key = `${red},${green},${blue}`;
        if(! paletteKeys.has(key)) {
            paletteKeys.add(key);
            palette.push({ red, green, blue });
        }
    }
    if(palette.length > 256) {
        throw new BonkaProjectError(`scene rendering uses ${palette.length} colors; Butano regular backgrounds support at most 256`);
    }
    while(palette.length < 256) {
        palette.push({ red: 0, green: 0, blue: 0 });
    }
    const { encode } = await import(pathToFileURL(require.resolve("@nktkas/bmp")).href);
    return encode({ width: image.width, height: image.height, channels: 3, data }, { bitsPerPixel: 8, palette });
}

function spriteTransparencyKey(opaqueColors) {
    const candidates = [
        [255, 0, 255],
        [0, 255, 255],
    ];
    for(const color of candidates) {
        if(! opaqueColors.has(color.join(","))) {
            return color;
        }
    }
    for(let red = 0; red < 256; ++red) {
        for(let green = 0; green < 256; ++green) {
            for(let blue = 0; blue < 256; ++blue) {
                const color = [red, green, blue];
                if(! opaqueColors.has(color.join(","))) {
                    return color;
                }
            }
        }
    }
    throw new BonkaProjectError("sprite transparency key: no unused RGB color is available");
}

function encodeSpriteBitmap(image, maxColors) {
    const opaqueColors = new Map();
    for(let pixel = 0; pixel < image.width * image.height; ++pixel) {
        const source = pixel * 4;
        if(! image.data[source + 3]) {
            continue;
        }
        const color = [image.data[source], image.data[source + 1], image.data[source + 2]];
        opaqueColors.set(color.join(","), color);
    }
    if(opaqueColors.size > maxColors - 1) {
        throw new BonkaProjectError(`sprite source uses ${opaqueColors.size} opaque colors, exceeding the ${maxColors - 1} available colors after reserving transparency`);
    }

    const palette = [spriteTransparencyKey(opaqueColors), ...opaqueColors.values()];
    const indices = new Map(palette.map((color, index) => [color.join(","), index]));
    // Grit requires a complete palette for 8-bit BMP inputs with more than 16 colors.
    while(palette.length < 256) {
        palette.push(palette[0]);
    }
    const rowStride = Math.ceil(image.width / 4) * 4;
    const pixelData = Buffer.alloc(rowStride * image.height);
    for(let y = 0; y < image.height; ++y) {
        for(let x = 0; x < image.width; ++x) {
            const source = (y * image.width + x) * 4;
            if(image.data[source + 3]) {
                pixelData[(image.height - 1 - y) * rowStride + x] = indices.get(`${image.data[source]},${image.data[source + 1]},${image.data[source + 2]}`);
            }
        }
    }

    const headerSize = 14 + 40;
    const paletteSize = palette.length * 4;
    const output = Buffer.alloc(headerSize + paletteSize + pixelData.length);
    output.write("BM", 0, "ascii");
    output.writeUInt32LE(output.length, 2);
    output.writeUInt32LE(headerSize + paletteSize, 10);
    output.writeUInt32LE(40, 14);
    output.writeInt32LE(image.width, 18);
    output.writeInt32LE(image.height, 22);
    output.writeUInt16LE(1, 26);
    output.writeUInt16LE(8, 28);
    output.writeUInt32LE(pixelData.length, 34);
    output.writeUInt32LE(palette.length, 46);
    for(const [index, [red, green, blue]] of palette.entries()) {
        const offset = headerSize + index * 4;
        output[offset] = blue;
        output[offset + 1] = green;
        output[offset + 2] = red;
    }
    pixelData.copy(output, headerSize + paletteSize);
    return output;
}

async function loadTilesetImage(project, tileset) {
    const sourcePath = project.sourcePaths.get(`tileset:${tileset.id}`);
    if(path.extname(sourcePath).toLowerCase() !== ".png") {
        throw new BonkaProjectError(`tilesets/${tileset.id}/source: GBA generation currently requires a PNG source image`);
    }

    let image;
    try {
        image = PNG.sync.read(await readFile(sourcePath));
    } catch(error) {
        throw new BonkaProjectError(`tilesets/${tileset.id}/source: unable to decode PNG: ${error.message}`);
    }
    if(image.width !== tileset.layout.imageWidth || image.height !== tileset.layout.imageHeight) {
        throw new BonkaProjectError(
            `tilesets/${tileset.id}/source: decoded image is ${image.width}x${image.height}, expected ${tileset.layout.imageWidth}x${tileset.layout.imageHeight}`
        );
    }
    return image;
}

async function loadTilesets(project) {
    const images = new Map();
    for(const [id, tileset] of project.tilesets) {
        images.set(id, await loadTilesetImage(project, tileset));
    }
    return images;
}

async function loadSpriteImage(project, sprite) {
    const sourcePath = project.sourcePaths.get(`sprite:${sprite.id}`);
    if(path.extname(sourcePath).toLowerCase() !== ".png") {
        throw new BonkaProjectError(`sprites/${sprite.id}/source: GBA generation currently requires a PNG source image`);
    }
    let image;
    try {
        image = PNG.sync.read(await readFile(sourcePath));
    } catch(error) {
        throw new BonkaProjectError(`sprites/${sprite.id}/source: unable to decode PNG: ${error.message}`);
    }
    if(sprite.layout && (image.width !== sprite.layout.imageWidth || image.height !== sprite.layout.imageHeight)) {
        throw new BonkaProjectError(
            `sprites/${sprite.id}/source: decoded image is ${image.width}x${image.height}, expected ${sprite.layout.imageWidth}x${sprite.layout.imageHeight}`
        );
    }
    return image;
}

function spriteLayout(sprite, animation = null) {
    return animation?.layout ?? sprite.layout ?? {
        imageWidth: sprite.frameSize.width * sprite.frameCount,
        imageHeight: sprite.frameSize.height,
        columns: sprite.frameCount,
        rows: 1,
        margin: { x: 0, y: 0 },
        spacing: { x: 0, y: 0 },
    };
}

function extractSpriteAnimation(sprite, image, animation) {
    const layout = spriteLayout(sprite, animation);
    const output = {
        width: sprite.frameSize.width * animation.frames.length,
        height: sprite.frameSize.height,
        data: Buffer.alloc(sprite.frameSize.width * animation.frames.length * sprite.frameSize.height * 4),
    };
    const colors = new Set();
    for(const [outputFrame, frame] of animation.frames.entries()) {
        const sourceX = layout.margin.x + (frame.index % layout.columns) * (sprite.frameSize.width + layout.spacing.x);
        const sourceY = layout.margin.y + Math.floor(frame.index / layout.columns) * (sprite.frameSize.height + layout.spacing.y);
        for(let y = 0; y < sprite.frameSize.height; ++y) {
            for(let x = 0; x < sprite.frameSize.width; ++x) {
                const source = ((sourceY + y) * image.width + sourceX + x) * 4;
                const target = (y * output.width + outputFrame * sprite.frameSize.width + x) * 4;
                image.data.copy(output.data, target, source, source + 4);
                if(image.data[source + 3]) {
                    colors.add(`${image.data[source]},${image.data[source + 1]},${image.data[source + 2]}`);
                }
            }
        }
    }
    if(colors.size > sprite.gba.colors - 1) {
        throw new BonkaProjectError(`sprites/${sprite.id}/source: uses ${colors.size} opaque colors, exceeding ${sprite.gba.colors - 1} available colors after reserving transparency`);
    }
    return output;
}

function spriteOutputName(sprite, animationId) {
    return `bonka_sprite_${sprite.id.replaceAll("-", "_")}_${animationId.replaceAll("-", "_")}`;
}

function spriteRuntimeName(sprite) {
    return `bonka_sprite_${sprite.id.replaceAll("-", "_")}_clips`;
}

function cppString(value) {
    let result = "\"";
    for(const byte of Buffer.from(value, "utf8")) {
        if(byte === 34) result += "\\\"";
        else if(byte === 92) result += "\\\\";
        else if(byte >= 32 && byte <= 126) result += String.fromCharCode(byte);
        else result += `\\${byte.toString(8).padStart(3, "0")}`;
    }
    return `${result}\"`;
}

function fixedNumberData(value, source) {
    const scaled = value * 4096;
    const result = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
    if(! Number.isSafeInteger(result) || result < -2147483648 || result > 2147483647) {
        throw new BonkaProjectError(`${source}: number ${value} is outside the GBA Q20.12 fixed-point range`);
    }
    return result;
}

function spriteHeader(sprite, animationId) {
    const name = spriteOutputName(sprite, animationId);
    const guard = `${name.toUpperCase()}_H`;
    const layout = spriteLayout(sprite, sprite.animations[animationId]);
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        `#ifndef ${guard}`,
        `#define ${guard}`,
        "",
        `namespace bonka::generated::${name} {`,
        `constexpr int FRAME_WIDTH = ${sprite.frameSize.width};`,
        `constexpr int FRAME_HEIGHT = ${sprite.frameSize.height};`,
        `constexpr int FRAME_COUNT = ${sprite.frameCount};`,
        `constexpr int COLUMNS = ${layout.columns};`,
        `constexpr int ROWS = ${layout.rows};`,
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function spriteRuntimeHeader(sprite, animationIds) {
    const name = spriteRuntimeName(sprite);
    const guard = `${name.toUpperCase()}_H`;
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        `#ifndef ${guard}`,
        `#define ${guard}`,
        "",
        "#include \"bonka/gba/sprite_runtime.h\"",
        ...animationIds.map(animationId => `#include \"bn_sprite_items_${spriteOutputName(sprite, animationId)}.h\"`),
        "",
        `namespace bonka::generated::${name} {`,
        "",
        ...animationIds.flatMap(animationId => {
            const animation = sprite.animations[animationId];
            const clip = `clip_${animationId.replaceAll("-", "_")}`;
            const tileBytes = sprite.frameSize.width * sprite.frameSize.height * animation.frames.length * (sprite.gba.bpp === 4 ? .5 : 1);
            return [
                `inline constexpr int ${clip}_durations[] = { ${animation.frames.map(frame => frame.duration).join(", ")} };`,
                `inline const bonka::gba::sprite_clip ${clip}(bn::sprite_items::${spriteOutputName(sprite, animationId)}, ${clip}_durations, ${animation.frames.length}, ${animation.loop}, ${tileBytes});`,
                "",
            ];
        }),
        ...sprite.directionalSets?.flatMap(set => {
            const name = `directional_set_${set.id.replaceAll("-", "_")}`;
            return [
                `inline const bonka::gba::directional_sprite_variant ${name}_variants[] = {`,
                ...set.variants.map(variant => `    { ${variant.angle}, clip_${variant.animation.replaceAll("-", "_")} },`),
                "};",
                `inline const bonka::gba::directional_sprite_set ${name}(${name}_variants, ${set.variants.length});`,
                "",
            ];
        }) ?? [],
        `inline constexpr int tile_bytes = ${animationIds.reduce((total, animationId) => total + sprite.frameSize.width * sprite.frameSize.height * sprite.animations[animationId].frames.length * (sprite.gba.bpp === 4 ? .5 : 1), 0)};`,
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function spriteRegistryHeader(project) {
    const entries = [...project.sprites.values()].flatMap(sprite =>
        (sprite.directionalSets ?? []).map(set => ({
            assetId: sprite.id,
            setId: set.id,
            runtimeName: spriteRuntimeName(sprite),
            setName: `directional_set_${set.id.replaceAll("-", "_")}`,
        })));
    const includes = [...new Set(entries.map(entry => entry.runtimeName))];
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        "#ifndef BONKA_SPRITE_REGISTRY_H",
        "#define BONKA_SPRITE_REGISTRY_H",
        "",
        "#include \"bonka/gba/sprite_runtime.h\"",
        ...includes.map(name => `#include \"${name}.h\"`),
        "",
        "namespace bonka::generated {",
        "",
        `inline constexpr int directional_sprite_set_count = ${entries.length};`,
        ...(entries.length ? [
            "inline const bonka::gba::directional_sprite_set_descriptor directional_sprite_sets[] = {",
            ...entries.map(entry => `    { ${cppString(entry.assetId)}, ${cppString(entry.setId)}, ${entry.runtimeName}::${entry.setName} },`),
            "};",
        ] : []),
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function selectedInputHeader(project) {
    const inputMap = project.manifest.inputMap === undefined ? null : project.inputMaps.get(project.manifest.inputMap);
    const actions = inputMap?.actions.map((action, index) => ({
        id: action.id,
        mask: 2 ** index,
        bindings: action.bindings,
    })) ?? [];
    const bindings = actions.flatMap(action => action.bindings.map(binding => ({ ...binding, mask: action.mask })));
    const mask = value => `0x${value.toString(16).padStart(8, "0")}u`;
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        "#ifndef BONKA_SELECTED_INPUT_H",
        "#define BONKA_SELECTED_INPUT_H",
        "",
        "#include \"bonka/gba/input_runtime.h\"",
        "",
        "#include <cstdint>",
        "",
        "namespace bonka::generated {",
        "",
        "struct input_action_descriptor {",
        "    const char* id;",
        "    uint32_t mask;",
        "};",
        `inline constexpr const char* selected_input_map_id = ${inputMap ? cppString(inputMap.id) : "nullptr"};`,
        `inline constexpr int input_action_count = ${actions.length};`,
        ...(actions.length ? [
            "inline constexpr input_action_descriptor input_actions[] = {",
            ...actions.map(action => `    { ${cppString(action.id)}, ${mask(action.mask)} },`),
            "};",
        ] : ["inline constexpr const input_action_descriptor* input_actions = nullptr;"]),
        `inline constexpr int input_binding_count = ${bindings.length};`,
        ...(bindings.length ? [
            "inline constexpr bonka::gba::input_binding_descriptor input_bindings[] = {",
            ...bindings.map(binding => `    { ${mask(binding.mask)}, bonka::gba::gba_control::${binding.control}, bonka::gba::input_trigger::${binding.trigger} },`),
            "};",
        ] : ["inline constexpr const bonka::gba::input_binding_descriptor* input_bindings = nullptr;"]),
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function flattenedLayers(layers, inherited = { visible: true, opacity: 1, x: 0, y: 0 }) {
    const result = [];
    for(const layer of layers) {
        const context = {
            visible: inherited.visible && layer.visible,
            opacity: inherited.opacity * layer.opacity,
            x: inherited.x + layer.offset.x,
            y: inherited.y + layer.offset.y,
        };
        if(layer.type === "group") {
            result.push(...flattenedLayers(layer.layers, context));
        } else {
            result.push({ layer, ...context });
        }
    }
    return result;
}

function drawSourceTile(destination, source, sourceX, sourceY, tileSize, destinationX, destinationY, flip, opacity) {
    for(let y = 0; y < tileSize.height; ++y) {
        const targetY = destinationY + y;
        if(targetY < 0 || targetY >= destination.height) {
            continue;
        }
        const imageY = sourceY + (flip.y ? tileSize.height - 1 - y : y);
        for(let x = 0; x < tileSize.width; ++x) {
            const targetX = destinationX + x;
            if(targetX < 0 || targetX >= destination.width) {
                continue;
            }
            const imageX = sourceX + (flip.x ? tileSize.width - 1 - x : x);
            const sourceIndex = (imageY * source.width + imageX) * 4;
            const destinationIndex = (targetY * destination.width + targetX) * 4;
            blend(
                destination.data,
                destinationIndex,
                source.data[sourceIndex],
                source.data[sourceIndex + 1],
                source.data[sourceIndex + 2],
                Math.round(source.data[sourceIndex + 3] * opacity)
            );
        }
    }
}

function renderScene(project, scene, images) {
    const width = scene.size.columns * scene.grid.width;
    const height = scene.size.rows * scene.grid.height;
    if(! REGULAR_BG_DIMENSIONS.has(width) || ! REGULAR_BG_DIMENSIONS.has(height)) {
        throw new BonkaProjectError(
            `scenes/${scene.id}: ${width}x${height} pixels is not a supported Butano regular background size`
        );
    }

    const image = { width, height, data: Buffer.alloc(width * height * 4) };
    const placements = flattenedLayers(scene.layers)
        .filter(layer => layer.visible && layer.opacity && layer.layer.type === "tile")
        .flatMap((view, layerIndex) => view.layer.placements.map((placement, placementIndex) => ({
            ...view,
            placement,
            layerIndex,
            placementIndex,
        })))
        .sort((left, right) =>
            left.layer.order - right.layer.order ||
            left.placement.cell.y - right.placement.cell.y ||
            left.placement.cell.x - right.placement.cell.x ||
            left.layerIndex - right.layerIndex ||
            left.placementIndex - right.placementIndex);
    for(const { placement, opacity, x: offsetX, y: offsetY } of placements) {
        const metatile = project.metatiles.get(placement.metatile);
        if(! metatile.visible || ! metatile.opacity) {
            continue;
        }
        const flip = placement.flip ?? { x: false, y: false };
        for(let metatileY = 0; metatileY < metatile.rows; ++metatileY) {
            for(let metatileX = 0; metatileX < metatile.columns; ++metatileX) {
                const tile = metatile.tiles[metatileY * metatile.columns + metatileX];
                if(tile === null) {
                    continue;
                }
                const tileset = project.tilesets.get(tile.tileset);
                const source = images.get(tileset.id);
                const sourceColumn = tile.tile % tileset.layout.columns;
                const sourceRow = Math.floor(tile.tile / tileset.layout.columns);
                const destinationColumn = flip.x ? metatile.columns - 1 - metatileX : metatileX;
                const destinationRow = flip.y ? metatile.rows - 1 - metatileY : metatileY;
                drawSourceTile(
                    image,
                    source,
                    tileset.layout.margin + sourceColumn * (tileset.tileSize.width + tileset.layout.spacing),
                    tileset.layout.margin + sourceRow * (tileset.tileSize.height + tileset.layout.spacing),
                    tileset.tileSize,
                    placement.cell.x * scene.grid.width + destinationColumn * metatile.tileSize.width + offsetX,
                    placement.cell.y * scene.grid.height + destinationRow * metatile.tileSize.height + offsetY,
                    flip,
                    opacity * metatile.opacity
                );
            }
        }
    }
    return image;
}

function flipTile(tile, horizontal, vertical) {
    const flipped = Buffer.alloc(8 * 8 * 3);
    for(let y = 0; y < 8; ++y) {
        for(let x = 0; x < 8; ++x) {
            const source = ((vertical ? 7 - y : y) * 8 + (horizontal ? 7 - x : x)) * 3;
            tile.copy(flipped, (y * 8 + x) * 3, source, source + 3);
        }
    }
    return flipped;
}

function tileSignature(tile) {
    return tile.toString("base64");
}

function mapCellOffset(column, row, columns) {
    const blocksPerRow = columns / 32;
    const block = Math.floor(row / 32) * blocksPerRow + Math.floor(column / 32);
    return block * 1024 + row % 32 * 32 + column % 32;
}

function buildTileBank(image) {
    const logicalColumns = image.width / 8;
    const logicalRows = image.height / 8;
    const mapColumns = Math.max(32, Math.ceil(logicalColumns / 32) * 32);
    const mapRows = Math.max(32, Math.ceil(logicalRows / 32) * 32);
    const tiles = [Buffer.alloc(8 * 8 * 3)];
    const variants = new Map();
    const mapCells = new Uint16Array(mapColumns * mapRows);

    const register = (tile, index) => {
        for(const variant of [
            { tile, horizontal: false, vertical: false },
            { tile: flipTile(tile, true, false), horizontal: true, vertical: false },
            { tile: flipTile(tile, false, true), horizontal: false, vertical: true },
            { tile: flipTile(tile, true, true), horizontal: true, vertical: true },
        ]) {
            const key = tileSignature(variant.tile);
            if(! variants.has(key)) {
                variants.set(key, { index, horizontal: variant.horizontal, vertical: variant.vertical });
            }
        }
    };
    register(tiles[0], 0);

    for(let tileY = 0; tileY < logicalRows; ++tileY) {
        for(let tileX = 0; tileX < logicalColumns; ++tileX) {
            const tile = Buffer.alloc(8 * 8 * 3);
            for(let y = 0; y < 8; ++y) {
                for(let x = 0; x < 8; ++x) {
                    const source = ((tileY * 8 + y) * image.width + tileX * 8 + x) * 4;
                    const destination = (y * 8 + x) * 3;
                    const alpha = image.data[source + 3];
                    tile[destination] = Math.round(image.data[source] * alpha / 255);
                    tile[destination + 1] = Math.round(image.data[source + 1] * alpha / 255);
                    tile[destination + 2] = Math.round(image.data[source + 2] * alpha / 255);
                }
            }
            let variant = variants.get(tileSignature(tile));
            if(! variant) {
                if(tiles.length === 512) {
                    throw new BonkaProjectError(`scenes/${image.id}: rendering needs more than 512 unique 8x8 BPP8 tiles`);
                }
                variant = { index: tiles.length, horizontal: false, vertical: false };
                tiles.push(tile);
                register(tile, variant.index);
            }
            mapCells[mapCellOffset(tileX, tileY, mapColumns)] = variant.index |
                (variant.horizontal ? 1 << 10 : 0) |
                (variant.vertical ? 1 << 11 : 0);
        }
    }

    return { logicalColumns, logicalRows, mapColumns, mapRows, mapCells, tiles };
}

async function encodeTileBank(bank) {
    const columns = Math.min(16, bank.tiles.length);
    const rows = Math.ceil(bank.tiles.length / columns);
    const image = { width: columns * 8, height: rows * 8, data: Buffer.alloc(columns * rows * 8 * 8 * 4) };
    for(let offset = 3; offset < image.data.length; offset += 4) {
        image.data[offset] = 255;
    }
    for(let index = 0; index < bank.tiles.length; ++index) {
        const tile = bank.tiles[index];
        const tileX = index % columns * 8;
        const tileY = Math.floor(index / columns) * 8;
        for(let y = 0; y < 8; ++y) {
            for(let x = 0; x < 8; ++x) {
                const source = (y * 8 + x) * 3;
                const destination = ((tileY + y) * image.width + tileX + x) * 4;
                image.data[destination] = tile[source];
                image.data[destination + 1] = tile[source + 1];
                image.data[destination + 2] = tile[source + 2];
            }
        }
    }
    return encodeBitmap(image);
}

function sceneHeader(scene) {
    const guard = includeGuard(scene.id);
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        `#ifndef ${guard}`,
        `#define ${guard}`,
        "",
        "namespace bonka::generated {",
        "",
        `namespace ${outputName(scene.id)} {`,
        `constexpr int CELLS_X = ${scene.size.columns};`,
        `constexpr int CELLS_Y = ${scene.size.rows};`,
        `constexpr int PIXELS_X = ${scene.size.columns * scene.grid.width};`,
        `constexpr int PIXELS_Y = ${scene.size.rows * scene.grid.height};`,
        "}",
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function sceneMapHeader(scene, bank) {
    const name = outputName(scene.id);
    const guard = `${name.toUpperCase()}_MAP_H`;
    const namespace = `${name}_map`;
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        `#ifndef ${guard}`,
        `#define ${guard}`,
        "",
        "#include \"bn_regular_bg_map_cell.h\"",
        "#include \"bn_regular_bg_map_item.h\"",
        "#include \"bn_size.h\"",
        "",
        "namespace bonka::generated::" + namespace + " {",
        "",
        `constexpr int COLUMNS = ${bank.mapColumns};`,
        `constexpr int ROWS = ${bank.mapRows};`,
        "namespace detail {",
        "constexpr const bn::regular_bg_map_cell CELLS[COLUMNS * ROWS] = {",
        ...Array.from({ length: bank.mapRows }, (_, row) => `    ${Array.from(bank.mapCells.subarray(row * bank.mapColumns, (row + 1) * bank.mapColumns), cell => `0x${cell.toString(16).padStart(4, "0")}`).join(", ")},`),
        "};",
        "}",
        "",
        "constexpr bn::regular_bg_map_item item(detail::CELLS[0], bn::size(COLUMNS, ROWS));",
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function startSceneHeader(scene) {
    const name = outputName(scene.id);
    const pixelsX = scene.size.columns * scene.grid.width;
    const pixelsY = scene.size.rows * scene.grid.height;
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        "#ifndef BONKA_START_SCENE_H",
        "#define BONKA_START_SCENE_H",
        "",
        "#include \"bn_regular_bg_item.h\"",
        `#include \"bn_regular_bg_tiles_items_${name}.h\"`,
        `#include \"${name}_map.h\"`,
        "",
        "namespace bonka::generated {",
        "",
        `inline constexpr bn::regular_bg_item start_scene_background(bn::regular_bg_tiles_items::${name}, bn::regular_bg_tiles_items::${name}_palette, ${name}_map::item);`,
        `constexpr int start_scene_pixels_x = ${pixelsX};`,
        `constexpr int start_scene_pixels_y = ${pixelsY};`,
        "constexpr int start_scene_background_center_x = 0;",
        "constexpr int start_scene_background_center_y = 0;",
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function nearestDirectionalAnimation(set, angle) {
    return set.variants.reduce((closest, variant) => {
        const distance = Math.abs((variant.angle - angle + 540) % 360 - 180);
        const closestDistance = Math.abs((closest.angle - angle + 540) % 360 - 180);
        return distance < closestDistance ? variant : closest;
    }).animation;
}

function entityAnimation(project, entity, component) {
    if(component.animation) return component.animation;
    const sprite = project.sprites.get(component.asset);
    const set = sprite.directionalSets.find(item => item.id === component.directionalSet);
    return nearestDirectionalAnimation(set, entity.facingAngle ?? 0);
}

function entityAnimationIds(project, entity, component) {
    if(component.animation) return [component.animation];
    const sprite = project.sprites.get(component.asset);
    return sprite.directionalSets.find(item => item.id === component.directionalSet).variants.map(variant => variant.animation);
}

function startSceneEntitiesHeader(project, scene) {
    const selectedInputMap = project.manifest.inputMap === undefined ? null : project.inputMaps.get(project.manifest.inputMap);
    const actionMasks = new Map(selectedInputMap?.actions.map((action, index) => [action.id, 2 ** index]) ?? []);
    const entities = scene.entities.map((entity, index) => {
        const behavior = project.entities.get(entity.definition)?.components.behavior;
        const parameters = Object.entries(behavior?.parameters ?? {}).sort(([left], [right]) => left.localeCompare(right));
        return {
            instanceId: entity.id,
            definitionId: entity.definition,
            behaviorId: behavior?.id ?? null,
            inputActionMask: (behavior?.inputActions ?? []).reduce(
                (mask, action) => (mask | (actionMasks.get(action) ?? 0)) >>> 0, 0),
            parameters,
            parametersName: `start_scene_entity_${index}_parameters`,
        };
    });
    const sprites = scene.entities.flatMap(entity => {
        const definition = project.entities.get(entity.definition);
        const component = definition?.components.sprite;
        if(! component) {
            return [];
        }

        const sprite = project.sprites.get(component.asset);
        const animationId = entityAnimation(project, entity, component);
        const x = entity.cell.x * scene.grid.width + Math.floor(scene.grid.width / 2) - scene.size.columns * scene.grid.width / 2;
        const y = entity.cell.y * scene.grid.height + Math.floor(scene.grid.height / 2) - scene.size.rows * scene.grid.height / 2;
        return [{
            instanceId: entity.id,
            runtimeName: spriteRuntimeName(sprite),
            clipName: `clip_${animationId.replaceAll("-", "_")}`,
            x,
            y,
            facingAngle: entity.facingAngle ?? 0,
            // Butano draws higher z values first, so the lower z at a greater
            // screen foot is covered later and appears in front.
            screenFootDepth: y + Math.floor(sprite.frameSize.height / 2),
        }];
    }).sort((left, right) =>
        left.screenFootDepth - right.screenFootDepth ||
        left.x - right.x ||
        left.instanceId.localeCompare(right.instanceId));
    const includes = [...new Set(sprites.map(sprite => sprite.runtimeName))];
    const parameterInitializer = ([name, value], entityId) => {
        if(typeof value === "string") {
            return `    { ${cppString(name)}, behavior_parameter_type::string, ${cppString(value)}, 0, false },`;
        }
        if(typeof value === "number") {
            return `    { ${cppString(name)}, behavior_parameter_type::number, nullptr, ${fixedNumberData(value, `entities/${entityId}/components/behavior/parameters/${name}`)}, false },`;
        }
        return `    { ${cppString(name)}, behavior_parameter_type::boolean, nullptr, 0, ${value} },`;
    };
    return [
        "// Generated by @bonka/target-gba. Do not edit.",
        "#ifndef BONKA_START_SCENE_ENTITIES_H",
        "#define BONKA_START_SCENE_ENTITIES_H",
        "",
        "#include \"bonka/gba/sprite_runtime.h\"",
        "#include <cstdint>",
        ...includes.map(name => `#include \"${name}.h\"`),
        "",
        "namespace bonka::generated {",
        "",
        `constexpr int start_scene_entity_count = ${entities.length};`,
        "enum class behavior_parameter_type : uint8_t { string, number, boolean };",
        "struct behavior_parameter_descriptor {",
        "    const char* name;",
        "    behavior_parameter_type type;",
        "    const char* string_value;",
        "    int32_t number_q20_12;",
        "    bool bool_value;",
        "};",
        "struct start_scene_entity_descriptor {",
        "    const char* instance_id;",
        "    const char* behavior_id;",
        "    uint32_t input_action_mask;",
        "    const behavior_parameter_descriptor* parameters;",
        "    int parameter_count;",
        "};",
        ...entities.flatMap(entity => entity.parameters.length ? [
            `inline constexpr behavior_parameter_descriptor ${entity.parametersName}[] = {`,
            ...entity.parameters.map(parameter => parameterInitializer(parameter, entity.definitionId)),
            "};",
        ] : []),
        ...(entities.length ? [
            "inline constexpr start_scene_entity_descriptor start_scene_entity_descriptors[] = {",
            ...entities.map(entity => `    { ${cppString(entity.instanceId)}, ${entity.behaviorId === null ? "nullptr" : cppString(entity.behaviorId)}, 0x${entity.inputActionMask.toString(16).padStart(8, "0")}u, ${entity.parameters.length ? entity.parametersName : "nullptr"}, ${entity.parameters.length} },`),
            "};",
        ] : []),
        "",
        `constexpr int start_scene_sprite_count = ${sprites.length};`,
        "struct start_scene_sprite_descriptor {",
        "    const char* instance_id;",
        "    const bonka::gba::sprite_clip& clip;",
        "    int x;",
        "    int y;",
        "    int facing_angle;",
        "    int foot_y_offset;",
        "};",
        ...(sprites.length ? [
            "inline const start_scene_sprite_descriptor start_scene_sprite_descriptors[] = {",
            ...sprites.map(sprite => `    { ${cppString(sprite.instanceId)}, ${sprite.runtimeName}::${sprite.clipName}, ${sprite.x}, ${sprite.y}, ${sprite.facingAngle}, ${sprite.screenFootDepth - sprite.y} },`),
            "};",
        ] : []),
        "",
        "}",
        "",
        "#endif",
        "",
    ].join("\n");
}

function generatedMakefile(project) {
    const inputs = [project.manifestPath, ...project.resourcePaths.values(), ...project.sourcePaths.values()]
        .map(filePath => makePath(project.rootDir, filePath))
        .sort();
    return [
        "# Generated by @bonka/target-gba. Do not edit.",
        `BONKA_INPUTS := ${inputs.join(" ")}`,
        "INCLUDES += .bonka/include",
        "GRAPHICS += .bonka/graphics",
        "",
    ].join("\n");
}

async function ensureGeneratedDirectory(generatedDir) {
    try {
        const entry = await lstat(generatedDir);
        if(entry.isSymbolicLink() || ! entry.isDirectory()) {
            throw new BonkaProjectError(`${generatedDir}: generated output must be a real directory`);
        }
    } catch(error) {
        if(error instanceof BonkaProjectError || error.code !== "ENOENT") {
            throw error;
        }
    }
    await mkdir(generatedDir, { recursive: true });
}

async function publishGeneratedOutput(project, files) {
    const generatedDir = path.join(project.rootDir, ".bonka");
    await ensureGeneratedDirectory(generatedDir);
    const stagingDir = await mkdtemp(path.join(generatedDir, ".stage-"));
    try {
        for(const [relativePath, contents] of files) {
            const outputPath = path.join(stagingDir, relativePath);
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, contents);
        }
        for(const relativePath of ["generated.mk", "graphics", "include"]) {
            const outputPath = path.join(generatedDir, relativePath);
            await rm(outputPath, { recursive: true, force: true });
            await rename(path.join(stagingDir, relativePath), outputPath);
        }
        await rm(stagingDir, { recursive: true, force: true });
    } catch(error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

export async function generateGbaProject(projectFile = "bonka.config.json") {
    const project = await loadBonkaProject(projectFile);
    const images = await loadTilesets(project);
    const files = [
        ["generated.mk", generatedMakefile(project)],
        ["include/bonka_selected_input.h", selectedInputHeader(project)],
    ];
    for(const scene of project.scenes.values()) {
        const name = outputName(scene.id);
        const image = renderScene(project, scene, images);
        image.id = scene.id;
        const bank = buildTileBank(image);
        files.push([`graphics/${name}.bmp`, await encodeTileBank(bank)]);
        files.push([`graphics/${name}.json`, `${JSON.stringify({ type: "regular_bg_tiles", bpp_mode: "bpp_8", generate_palette: true }, null, 2)}\n`]);
        files.push([`include/${name}.h`, sceneHeader(scene)]);
        files.push([`include/${name}_map.h`, sceneMapHeader(scene, bank)]);
    }
    const requiredSpriteAnimations = new Map();
    for(const [spriteId, sprite] of project.sprites) {
        for(const animationId of Object.keys(sprite.animations)) {
            requiredSpriteAnimations.set(`${spriteId}:${animationId}`, { spriteId, animationId });
        }
    }
    const animationIdsBySprite = new Map();
    for(const { spriteId, animationId } of requiredSpriteAnimations.values()) {
        const ids = animationIdsBySprite.get(spriteId) ?? [];
        ids.push(animationId);
        animationIdsBySprite.set(spriteId, ids);
    }
    for(const { spriteId, animationId } of requiredSpriteAnimations.values()) {
        const sprite = project.sprites.get(spriteId);
        const animation = sprite.animations[animationId];
        const image = await loadSpriteImage(project, sprite);
        const sheet = extractSpriteAnimation(sprite, image, animation);
        const name = spriteOutputName(sprite, animationId);
        files.push([`graphics/${name}.bmp`, encodeSpriteBitmap(sheet, sprite.gba.colors)]);
        files.push([`graphics/${name}.json`, `${JSON.stringify({ type: "sprite", width: sprite.frameSize.width, height: sprite.frameSize.height, bpp_mode: sprite.gba.bpp === 4 ? "bpp_4" : "bpp_8", generate_palette: true }, null, 2)}\n`]);
        files.push([`include/${name}.h`, spriteHeader(sprite, animationId)]);
    }
    for(const [spriteId, animationIds] of animationIdsBySprite) {
        const sprite = project.sprites.get(spriteId);
        files.push([`include/${spriteRuntimeName(sprite)}.h`, spriteRuntimeHeader(sprite, animationIds)]);
    }
    files.push(["include/bonka_sprite_registry.h", spriteRegistryHeader(project)]);
    const startScene = project.scenes.get(project.manifest.startScene);
    files.push(["include/bonka_start_scene.h", startSceneHeader(startScene)]);
    files.push(["include/bonka_start_scene_entities.h", startSceneEntitiesHeader(project, startScene)]);
    await publishGeneratedOutput(project, files);
    return { project, files: files.map(([filePath]) => filePath) };
}
