#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");

const projectDir = path.resolve(__dirname, "..", "..");
const TRANSPARENT_COLOR = [2, 3, 6];

function usage() {
    console.log("Usage: node devtools/bonka/generate_assets.cjs --scene <scene.json> --asset <name>");
}

function parseArguments() {
    const result = {};
    for(let index = 2; index < process.argv.length; ++index) {
        const argument = process.argv[index];
        if(argument === "--help" || argument === "-h") {
            usage();
            process.exit(0);
        }
        if(argument !== "--scene" && argument !== "--asset") {
            throw new Error(`Unknown argument: ${argument}`);
        }
        const value = process.argv[++index];
        if(! value || value.startsWith("--")) {
            throw new Error(`Missing value for ${argument}`);
        }
        result[argument.slice(2)] = value;
    }
    if(! result.scene || ! result.asset) {
        usage();
        throw new Error("Both --scene and --asset are required");
    }
    if(! /^[a-z][a-z0-9_]*$/.test(result.asset)) {
        throw new Error("Asset name must start with a lowercase letter and contain only lowercase letters, digits and underscores");
    }
    return result;
}

function integer(value, name, minimum = 0) {
    if(! Number.isInteger(value) || value < minimum) {
        throw new Error(`${name} must be an integer >= ${minimum}`);
    }
    return value;
}

function number(value, name, minimum, maximum) {
    if(! Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    return value;
}

function loadScene(scenePath) {
    const absolutePath = path.resolve(projectDir, scenePath);
    const scene = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if(scene.version !== 1 || scene.orientation !== "isometric") {
        throw new Error(`${scenePath}: unsupported Bonka scene version or orientation`);
    }
    for(const field of ["width", "height", "gridWidth", "gridHeight", "collisionGridWidth", "collisionGridHeight"]) {
        integer(scene[field], `scene.${field}`, 1);
    }
    if(! Array.isArray(scene.tilesets) || ! Array.isArray(scene.metatiles) || ! Array.isArray(scene.layers)) {
        throw new Error(`${scenePath}: tilesets, metatiles and layers must be arrays`);
    }
    return { scene, absolutePath };
}

function decodeTilesets(scene) {
    const result = new Map();
    for(const tileset of scene.tilesets) {
        integer(tileset.id, "tileset.id", 1);
        integer(tileset.columns, `tileset ${tileset.id}.columns`, 1);
        integer(tileset.tileCount, `tileset ${tileset.id}.tileCount`, 1);
        if(tileset.tileWidth !== 8 || tileset.tileHeight !== 8) {
            throw new Error(`Tileset ${tileset.id} must use 8x8 tiles`);
        }
        if(typeof tileset.image !== "string" || ! tileset.image.startsWith("data:image/png;base64,")) {
            throw new Error(`Tileset ${tileset.id} must contain an embedded PNG data URL`);
        }
        const image = PNG.sync.read(Buffer.from(tileset.image.slice(tileset.image.indexOf(",") + 1), "base64"));
        if(image.width !== tileset.imageWidth || image.height !== tileset.imageHeight || image.width % 8 || image.height % 8) {
            throw new Error(`Tileset ${tileset.id} image dimensions do not match its metadata or are not divisible by 8`);
        }
        if(tileset.columns !== image.width / 8 || tileset.tileCount !== image.width / 8 * (image.height / 8)) {
            throw new Error(`Tileset ${tileset.id} columns or tileCount do not match the embedded image`);
        }
        result.set(tileset.id, { definition: tileset, image });
    }
    return result;
}

function indexMetatiles(scene, tilesets) {
    const result = new Map();
    for(const metatile of scene.metatiles) {
        integer(metatile.id, "metatile.id", 1);
        const tileset = tilesets.get(metatile.tilesetId);
        if(! tileset) {
            throw new Error(`Metatile ${metatile.id} references missing tileset ${metatile.tilesetId}`);
        }
        integer(metatile.columns, `metatile ${metatile.id}.columns`, 1);
        integer(metatile.rows, `metatile ${metatile.id}.rows`, 1);
        const cells = metatile.columns * metatile.rows;
        if(! Array.isArray(metatile.data) || metatile.data.length !== cells ||
                ! Array.isArray(metatile.collisionMap) || metatile.collisionMap.length !== cells) {
            throw new Error(`Metatile ${metatile.id} data and collisionMap must contain ${cells} entries`);
        }
        metatile.data.forEach((tileId, index) => {
            if(tileId !== null && (! Number.isInteger(tileId) || tileId < 0 || tileId >= tileset.definition.tileCount)) {
                throw new Error(`Metatile ${metatile.id} has invalid tile ID at index ${index}`);
            }
        });
        result.set(metatile.id, metatile);
    }
    return result;
}

function flattenLayers(nodes, result = []) {
    for(const node of nodes) {
        if(Array.isArray(node.layers)) {
            flattenLayers(node.layers, result);
        } else if(node.type === "metatileLayer" && node.visible !== false) {
            result.push(node);
        }
    }
    return result;
}

function blendPixel(target, offset, red, green, blue, alpha) {
    if(alpha <= 0) {
        return;
    }
    if(alpha >= 255) {
        target[offset] = red;
        target[offset + 1] = green;
        target[offset + 2] = blue;
        target[offset + 3] = 255;
        return;
    }
    const destinationAlpha = target[offset + 3];
    const outputAlpha = alpha + Math.round(destinationAlpha * (255 - alpha) / 255);
    target[offset] = Math.round((red * alpha + target[offset] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    target[offset + 1] = Math.round((green * alpha + target[offset + 1] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    target[offset + 2] = Math.round((blue * alpha + target[offset + 2] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
    target[offset + 3] = outputAlpha;
}

function renderScene(scene, tilesets, metatiles) {
    const width = scene.width * scene.gridWidth;
    const height = scene.height * scene.gridHeight;
    const cells = new Map();
    const layers = flattenLayers(scene.layers).sort((left, right) => (left.order || 0) - (right.order || 0));

    function destinationCell(x, y) {
        const cellX = Math.floor(x / 8);
        const cellY = Math.floor(y / 8);
        const key = cellY * Math.ceil(width / 8) + cellX;
        let cell = cells.get(key);
        if(! cell) {
            cell = new Uint8Array(8 * 8 * 4);
            cells.set(key, cell);
        }
        return { cell, offset: ((y % 8) * 8 + (x % 8)) * 4 };
    }

    for(const layer of layers) {
        const opacity = number(layer.opacity ?? 1, `layer ${layer.id}.opacity`, 0, 1);
        const layerX = integer(layer.hOffset ?? 0, `layer ${layer.id}.hOffset`, -32768);
        const layerY = -integer(layer.zOffset ?? 0, `layer ${layer.id}.zOffset`, -32768);
        for(const placement of layer.metatiles || []) {
            const metatile = metatiles.get(placement.metatileId);
            if(! metatile || metatile.visible === false) {
                if(! metatile) {
                    throw new Error(`Layer ${layer.id} references missing metatile ${placement.metatileId}`);
                }
                continue;
            }
            const tileset = tilesets.get(metatile.tilesetId);
            const originX = integer(placement.x, "placement.x") * scene.gridWidth + layerX;
            const originY = integer(placement.y, "placement.y") * scene.gridHeight + layerY;
            const flipX = Boolean(placement.flip?.x);
            const flipY = Boolean(placement.flip?.y);
            const metaOpacity = number(metatile.opacity ?? 1, `metatile ${metatile.id}.opacity`, 0, 1);
            metatile.data.forEach((sourceTileId, sourceIndex) => {
                if(sourceTileId === null) {
                    return;
                }
                const sourceColumn = sourceIndex % metatile.columns;
                const sourceRow = Math.floor(sourceIndex / metatile.columns);
                const destinationColumn = flipX ? metatile.columns - 1 - sourceColumn : sourceColumn;
                const destinationRow = flipY ? metatile.rows - 1 - sourceRow : sourceRow;
                const sourceX = sourceTileId % tileset.definition.columns * 8;
                const sourceY = Math.floor(sourceTileId / tileset.definition.columns) * 8;
                for(let tileY = 0; tileY < 8; ++tileY) {
                    for(let tileX = 0; tileX < 8; ++tileX) {
                        const pixelX = flipX ? 7 - tileX : tileX;
                        const pixelY = flipY ? 7 - tileY : tileY;
                        const sourceOffset = ((sourceY + pixelY) * tileset.image.width + sourceX + pixelX) * 4;
                        const destinationX = originX + destinationColumn * 8 + tileX;
                        const destinationY = originY + destinationRow * 8 + tileY;
                        if(destinationX < 0 || destinationY < 0 || destinationX >= width || destinationY >= height) {
                            continue;
                        }
                        const destination = destinationCell(destinationX, destinationY);
                        const alpha = Math.round(tileset.image.data[sourceOffset + 3] * opacity * metaOpacity);
                        blendPixel(destination.cell, destination.offset, tileset.image.data[sourceOffset],
                                   tileset.image.data[sourceOffset + 1], tileset.image.data[sourceOffset + 2], alpha);
                    }
                }
            });
        }
    }
    return { width, height, cells };
}

function quantizeChannel(value) {
    return ((value >> 3) << 3) | (value >> 5);
}

function indexedCell(rgba, palette, paletteIndex) {
    const result = new Uint8Array(64);
    for(let pixel = 0; pixel < 64; ++pixel) {
        const offset = pixel * 4;
        if(! rgba[offset + 3]) {
            continue;
        }
        const color = [quantizeChannel(rgba[offset]), quantizeChannel(rgba[offset + 1]), quantizeChannel(rgba[offset + 2])];
        const key = color.join(",");
        let index = paletteIndex.get(key);
        if(index === undefined) {
            if(palette.length === 256) {
                throw new Error("Rendered scene uses more than 256 colors; BPP8 supports at most 256 including transparency");
            }
            index = palette.length;
            paletteIndex.set(key, index);
            palette.push(color);
        }
        result[pixel] = index;
    }
    return result;
}

function flipTile(tile, horizontal, vertical) {
    const result = new Uint8Array(64);
    for(let y = 0; y < 8; ++y) {
        for(let x = 0; x < 8; ++x) {
            result[y * 8 + x] = tile[(vertical ? 7 - y : y) * 8 + (horizontal ? 7 - x : x)];
        }
    }
    return result;
}

function signature(tile) {
    return crypto.createHash("sha256").update(tile).digest("hex");
}

function buildTileBank(scene, rendered) {
    const logicalColumns = Math.ceil(rendered.width / 8);
    const logicalRows = Math.ceil(rendered.height / 8);
    const mapColumns = Math.max(32, Math.ceil(logicalColumns / 32) * 32);
    const mapRows = Math.max(32, Math.ceil(logicalRows / 32) * 32);
    if(mapColumns > 2048 || mapRows > 2048) {
        throw new Error(`Map is too large for Butano: ${mapColumns}x${mapRows} cells (maximum 2048x2048)`);
    }
    const palette = [TRANSPARENT_COLOR];
    const paletteIndex = new Map([[TRANSPARENT_COLOR.join(","), 0]]);
    const tiles = [new Uint8Array(64)];
    const variants = new Map();

    function register(tile, index) {
        variants.set(signature(tile), { index, horizontal: false, vertical: false });
        variants.set(signature(flipTile(tile, true, false)), { index, horizontal: true, vertical: false });
        variants.set(signature(flipTile(tile, false, true)), { index, horizontal: false, vertical: true });
        variants.set(signature(flipTile(tile, true, true)), { index, horizontal: true, vertical: true });
    }
    register(tiles[0], 0);

    const mapCells = new Uint16Array(mapColumns * mapRows);
    for(let y = 0; y < logicalRows; ++y) {
        for(let x = 0; x < logicalColumns; ++x) {
            const rgba = rendered.cells.get(y * logicalColumns + x) || new Uint8Array(256);
            const tile = indexedCell(rgba, palette, paletteIndex);
            let variant = variants.get(signature(tile));
            if(! variant) {
                if(tiles.length === 1024) {
                    throw new Error("Rendered scene needs more than 1024 unique tiles; tile-bank streaming is not implemented yet");
                }
                variant = { index: tiles.length, horizontal: false, vertical: false };
                tiles.push(tile);
                register(tile, variant.index);
            }
            mapCells[y * mapColumns + x] = variant.index | (variant.horizontal ? 1 << 10 : 0) | (variant.vertical ? 1 << 11 : 0);
        }
    }
    return { logicalColumns, logicalRows, mapColumns, mapRows, mapCells, tiles, palette };
}

function buildCollision(scene, metatiles) {
    const pixelsX = scene.width * scene.gridWidth;
    const pixelsY = scene.height * scene.gridHeight;
    const columns = Math.ceil(pixelsX / scene.collisionGridWidth);
    const rows = Math.ceil(pixelsY / scene.collisionGridHeight);
    const collision = new Uint8Array(columns * rows);
    const layers = flattenLayers(scene.layers).sort((left, right) => (left.order || 0) - (right.order || 0));
    for(const layer of layers) {
        const layerX = layer.hOffset || 0;
        const layerY = -(layer.zOffset || 0);
        for(const placement of layer.metatiles || []) {
            const metatile = metatiles.get(placement.metatileId);
            if(! metatile || metatile.visible === false) {
                continue;
            }
            const originX = placement.x * scene.gridWidth + layerX;
            const originY = placement.y * scene.gridHeight + layerY;
            const flipX = Boolean(placement.flip?.x);
            const flipY = Boolean(placement.flip?.y);
            metatile.collisionMap.forEach((blocked, index) => {
                if(! blocked) {
                    return;
                }
                const sourceColumn = index % metatile.columns;
                const sourceRow = Math.floor(index / metatile.columns);
                const destinationColumn = flipX ? metatile.columns - 1 - sourceColumn : sourceColumn;
                const destinationRow = flipY ? metatile.rows - 1 - sourceRow : sourceRow;
                const left = originX + destinationColumn * 8;
                const top = originY + destinationRow * 8;
                const firstX = Math.floor(left / scene.collisionGridWidth);
                const lastX = Math.floor((left + 7) / scene.collisionGridWidth);
                const firstY = Math.floor(top / scene.collisionGridHeight);
                const lastY = Math.floor((top + 7) / scene.collisionGridHeight);
                for(let y = firstY; y <= lastY; ++y) {
                    for(let x = firstX; x <= lastX; ++x) {
                        if(x >= 0 && y >= 0 && x < columns && y < rows) {
                            collision[y * columns + x] = 1;
                        }
                    }
                }
            });
        }
    }
    return { columns, rows, collision };
}

function validateSpawns(scene, collision) {
    if(! scene.player || ! Number.isInteger(scene.player.x) || ! Number.isInteger(scene.player.y)) {
        throw new Error("Scene requires one player spawn");
    }
    if(! Array.isArray(scene.enemies) || ! scene.enemies.length) {
        throw new Error("Scene requires at least one enemy spawn");
    }
    const spawns = [{ name: "player", ...scene.player }, ...scene.enemies.map((enemy, index) => ({ name: `enemy ${index}`, ...enemy }))];
    for(const spawn of spawns) {
        const pixelX = spawn.x * scene.gridWidth + Math.floor(scene.gridWidth / 2);
        const pixelY = spawn.y * scene.gridHeight + Math.floor(scene.gridHeight / 2);
        if(pixelX < 0 || pixelY < 0 || pixelX >= scene.width * scene.gridWidth || pixelY >= scene.height * scene.gridHeight) {
            throw new Error(`${spawn.name} spawn (${spawn.x}, ${spawn.y}) is outside the scene`);
        }
        const collisionX = Math.floor(pixelX / scene.collisionGridWidth);
        const collisionY = Math.floor(pixelY / scene.collisionGridHeight);
        if(collision.collision[collisionY * collision.columns + collisionX]) {
            throw new Error(`${spawn.name} spawn is blocked at (${spawn.x}, ${spawn.y})`);
        }
    }
}

async function writeTiles(asset, bank) {
    const { encode } = await import("@nktkas/bmp");
    const tileColumns = Math.min(16, bank.tiles.length);
    const tileRows = Math.ceil(bank.tiles.length / tileColumns);
    const width = tileColumns * 8;
    const height = tileRows * 8;
    const data = new Uint8Array(width * height * 3);
    for(let offset = 0; offset < data.length; offset += 3) {
        data[offset] = TRANSPARENT_COLOR[0];
        data[offset + 1] = TRANSPARENT_COLOR[1];
        data[offset + 2] = TRANSPARENT_COLOR[2];
    }
    for(let tileIndex = 0; tileIndex < bank.tiles.length; ++tileIndex) {
        const tile = bank.tiles[tileIndex];
        const tileX = tileIndex % tileColumns * 8;
        const tileY = Math.floor(tileIndex / tileColumns) * 8;
        for(let y = 0; y < 8; ++y) {
            for(let x = 0; x < 8; ++x) {
                const color = bank.palette[tile[y * 8 + x]];
                const destination = ((tileY + y) * width + tileX + x) * 3;
                data[destination] = color[0];
                data[destination + 1] = color[1];
                data[destination + 2] = color[2];
            }
        }
    }
    const palette = bank.palette.map(([red, green, blue]) => ({ red, green, blue }));
    const paletteKeys = new Set(bank.palette.map((color) => color.join(",")));
    let paddingColor = 0;
    while(palette.length < 256) {
        const red = paddingColor & 255;
        const green = paddingColor >> 8 & 255;
        const blue = paddingColor >> 16 & 255;
        ++paddingColor;
        const key = `${red},${green},${blue}`;
        if(! paletteKeys.has(key)) {
            paletteKeys.add(key);
            palette.push({ red, green, blue });
        }
    }
    const paletteColorsCount = Math.ceil(bank.palette.length / 16) * 16;
    const bmp = encode({ width, height, channels: 3, data }, { bitsPerPixel: 8, palette });
    const pixelOffset = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength).getUint32(10, true);
    const rowSize = (width + 3) & ~3;
    for(let y = 0; y < height; ++y) {
        for(let x = 0; x < width; ++x) {
            const colorIndex = bmp[pixelOffset + y * rowSize + x];
            if(colorIndex >= paletteColorsCount) {
                throw new Error(`BMP encoder produced palette index ${colorIndex}, but Butano palette has ${paletteColorsCount} colors`);
            }
        }
    }
    const outputDir = path.join(projectDir, ".bonka", "graphics");
    fs.mkdirSync(outputDir, { recursive: true });
    const bmpPath = path.join(outputDir, `${asset}_tiles.bmp`);
    const jsonPath = path.join(outputDir, `${asset}_tiles.json`);
    fs.writeFileSync(bmpPath, bmp);
    fs.writeFileSync(jsonPath, JSON.stringify({
        type: "regular_bg_tiles",
        bpp_mode: "bpp_8",
        generate_palette: true,
        palette_colors_count: paletteColorsCount,
    }, null, 2) + "\n");
}

function headerText(asset, scene, bank, collision, scenePath) {
    const namespace = `${asset}_map`;
    const guard = `${asset.toUpperCase()}_MAP_DATA_H`;
    const player = scene.player;
    const enemies = scene.enemies;
    const lines = [
        `// Generated by devtools/bonka/generate_assets.cjs from ${scenePath} - do not edit.`,
        `#ifndef ${guard}`,
        `#define ${guard}`,
        "",
        "#include \"bn_compression_type.h\"",
        "#include \"bn_regular_bg_map_cell.h\"",
        "#include \"bn_regular_bg_map_item.h\"",
        "#include \"bn_size.h\"",
        "",
        `namespace ${namespace} {`,
        "",
        `constexpr int PIXELS_X = ${scene.width * scene.gridWidth};`,
        `constexpr int PIXELS_Y = ${scene.height * scene.gridHeight};`,
        `constexpr int CELL_W = ${scene.gridWidth};`,
        `constexpr int CELL_H = ${scene.gridHeight};`,
        `constexpr int CELLS_X = ${scene.width};`,
        `constexpr int CELLS_Y = ${scene.height};`,
        `constexpr int COLLISION_CELL_W = ${scene.collisionGridWidth};`,
        `constexpr int COLLISION_CELL_H = ${scene.collisionGridHeight};`,
        `constexpr int COLLISION_CELLS_X = ${collision.columns};`,
        `constexpr int COLLISION_CELLS_Y = ${collision.rows};`,
        `constexpr int PLAYER_CELL_X = ${player.x};`,
        `constexpr int PLAYER_CELL_Y = ${player.y};`,
        `constexpr int ENEMY_COUNT = ${enemies.length};`,
        `constexpr int ENEMY_CELL_X[ENEMY_COUNT] = {${enemies.map(enemy => enemy.x).join(", ")}};`,
        `constexpr int ENEMY_CELL_Y[ENEMY_COUNT] = {${enemies.map(enemy => enemy.y).join(", ")}};`,
        `constexpr int MAP_CELLS_X = ${bank.mapColumns};`,
        `constexpr int MAP_CELLS_Y = ${bank.mapRows};`,
        "",
        "namespace detail {",
        "constexpr const bool COLLISION[COLLISION_CELLS_X * COLLISION_CELLS_Y] = {",
    ];
    for(let y = 0; y < collision.rows; ++y) {
        lines.push("    " + Array.from(collision.collision.subarray(y * collision.columns, (y + 1) * collision.columns), value => value ? "true" : "false").join(", ") + ",");
    }
    lines.push("};", "", "constexpr const bn::regular_bg_map_cell MAP_CELLS[MAP_CELLS_X * MAP_CELLS_Y] = {");
    for(let y = 0; y < bank.mapRows; ++y) {
        lines.push("    " + Array.from(bank.mapCells.subarray(y * bank.mapColumns, (y + 1) * bank.mapColumns), value => `0x${value.toString(16).padStart(4, "0")}`).join(", ") + ",");
    }
    lines.push(
        "};",
        "}",
        "",
        "constexpr bool blocked_pixel(int pixel_x, int pixel_y) {",
        "    if(pixel_x < 0 || pixel_x >= PIXELS_X || pixel_y < 0 || pixel_y >= PIXELS_Y) {",
        "        return true;",
        "    }",
        "    return detail::COLLISION[(pixel_y / COLLISION_CELL_H) * COLLISION_CELLS_X + pixel_x / COLLISION_CELL_W];",
        "}",
        "",
    );
    if(bank.mapColumns > 32 || bank.mapRows > 32) {
        lines.push("constexpr bn::regular_bg_map_item ITEM(detail::MAP_CELLS[0], bn::size(MAP_CELLS_X, MAP_CELLS_Y), bn::compression_type::NONE, 1, true);");
    } else {
        lines.push("constexpr bn::regular_bg_map_item ITEM(detail::MAP_CELLS[0], bn::size(MAP_CELLS_X, MAP_CELLS_Y));");
    }
    lines.push("", "}", "", `#endif`, "");
    return lines.join("\n");
}

async function main() {
    const options = parseArguments();
    const { scene } = loadScene(options.scene);
    const tilesets = decodeTilesets(scene);
    const metatiles = indexMetatiles(scene, tilesets);
    const rendered = renderScene(scene, tilesets, metatiles);
    const bank = buildTileBank(scene, rendered);
    const collision = buildCollision(scene, metatiles);
    validateSpawns(scene, collision);
    await writeTiles(options.asset, bank);
    const includeDir = path.join(projectDir, ".bonka", "include");
    fs.mkdirSync(includeDir, { recursive: true });
    fs.writeFileSync(path.join(includeDir, `${options.asset}_map_data.h`),
                     headerText(options.asset, scene, bank, collision, options.scene));

    for(const extension of ["bmp", "json"]) {
        const legacyPath = path.join(projectDir, ".bonka", "graphics", `${options.asset}_map.${extension}`);
        if(fs.existsSync(legacyPath)) {
            fs.rmSync(legacyPath);
        }
    }
    console.log(`${options.asset}: ${rendered.width}x${rendered.height}px, map ${bank.mapColumns}x${bank.mapRows} cells`);
    console.log(`tiles: ${bank.tiles.length} unique / ${bank.logicalColumns * bank.logicalRows} visible cells, palette: ${bank.palette.length}/256`);
    console.log(`collision: ${collision.collision.reduce((sum, value) => sum + value, 0)} / ${collision.columns * collision.rows} blocked cells`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
