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

async function ensureGeneratedDirectory(rootDir, generatedDir) {
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
    await mkdir(rootDir, { recursive: true });
}

async function publishGeneratedOutput(project, files) {
    const generatedDir = path.join(project.rootDir, ".bonka");
    await ensureGeneratedDirectory(project.rootDir, generatedDir);
    const stagingDir = await mkdtemp(path.join(project.rootDir, ".bonka-stage-"));
    try {
        for(const [relativePath, contents] of files) {
            const outputPath = path.join(stagingDir, relativePath);
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, contents);
        }
        await rm(generatedDir, { recursive: true, force: true });
        await rename(stagingDir, generatedDir);
    } catch(error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

export async function generateGbaProject(projectFile = "bonka.config.json") {
    const project = await loadBonkaProject(projectFile);
    const images = await loadTilesets(project);
    const files = [["generated.mk", generatedMakefile(project)]];
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
    files.push(["include/bonka_start_scene.h", startSceneHeader(project.scenes.get(project.manifest.startScene))]);
    await publishGeneratedOutput(project, files);
    return { project, files: files.map(([filePath]) => filePath) };
}
