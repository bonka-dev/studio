(function(root, factory) {
    const api = factory();
    if(typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.MapCore = api;
    }
})(typeof globalThis === "object" ? globalThis : this, function() {
    "use strict";

    const CELL_W = 16;
    const CELL_H = 8;
    const CELLS_X = 32;
    const CELLS_Y = 64;
    const TILE_SIZE = 32;
    const SHEET_COLUMNS = 11;
    const SHEET_ROWS = 11;
    const MAP_PIXELS_X = CELLS_X * CELL_W;
    const MAP_PIXELS_Y = CELLS_Y * CELL_H;
    const MAX_TILE_ID = SHEET_COLUMNS * SHEET_ROWS - 1;
    const EMPTY_TILE_IDS = new Set([86, 87, 97, 98, 108, 109]);
    const BASE_BLOCKING_TILES = new Set([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    const TRANSPARENT_COLOR = [2, 3, 6];

    function error(path, lineNumber, message) {
        throw new Error(`Map ${path}:${lineNumber}: ${message}`);
    }

    function sheetOffset(tileId) {
        return {
            x: (tileId % SHEET_COLUMNS) * TILE_SIZE,
            y: Math.floor(tileId / SHEET_COLUMNS) * TILE_SIZE,
        };
    }

    function parseInteger(value, path, lineNumber, label) {
        if(!/^-?\d+$/.test(value)) {
            error(path, lineNumber, `${label} must be an integer`);
        }
        return Number(value);
    }

    function parseLayer(source, path, level) {
        let zOffset = level * CELL_H;
        let drawOrder = level;
        let hasZOffset = false;
        let hasDrawOrder = false;
        const tileLines = [];
        const spawns = [];

        source.split(/\r?\n/).forEach((raw, index) => {
            const lineNumber = index + 1;
            const line = raw.trim();
            if(!line || line.startsWith("#")) {
                return;
            }

            const parts = line.split(/\s+/);
            const directive = parts[0];
            if(directive === "Z") {
                if(parts.length !== 2 || hasZOffset) {
                    error(path, lineNumber, "expected one Z pixel offset");
                }
                zOffset = parseInteger(parts[1], path, lineNumber, "Z offset");
                if(zOffset < -512 || zOffset > 512) {
                    error(path, lineNumber, "Z offset must be between -512 and 512");
                }
                hasZOffset = true;
                return;
            }

            if(directive === "O") {
                if(parts.length !== 2 || hasDrawOrder) {
                    error(path, lineNumber, "expected one O draw order");
                }
                drawOrder = parseInteger(parts[1], path, lineNumber, "draw order");
                hasDrawOrder = true;
                return;
            }

            if(directive === "P" || directive === "E") {
                if(parts.length !== 3) {
                    error(path, lineNumber, "expected P <cell_x> <cell_y> or E <cell_x> <cell_y>");
                }
                spawns.push({
                    kind: directive === "P" ? "player" : "enemy",
                    x: parseInteger(parts[1], path, lineNumber, "spawn cell x"),
                    y: parseInteger(parts[2], path, lineNumber, "spawn cell y"),
                    path,
                    lineNumber,
                });
                return;
            }

            if(directive !== "T" || (parts.length !== 4 && parts.length !== 5)) {
                error(path, lineNumber, "expected T <tile_id> <cell_x> <cell_y> [F], Z <pixel_offset>, O <draw_order>, P <cell_x> <cell_y> or E <cell_x> <cell_y>");
            }

            const tileId = parseInteger(parts[1], path, lineNumber, "tile id");
            const cellX = parseInteger(parts[2], path, lineNumber, "cell x");
            const cellY = parseInteger(parts[3], path, lineNumber, "cell y");
            if(tileId < 0 || tileId > MAX_TILE_ID) {
                error(path, lineNumber, `tile id ${tileId} is outside 0..${MAX_TILE_ID}`);
            }
            if(EMPTY_TILE_IDS.has(tileId)) {
                error(path, lineNumber, `tile id ${tileId} is empty`);
            }
            if(cellX < 0 || cellX > CELLS_X - 2 || cellY < 0 || cellY > CELLS_Y - 4) {
                error(path, lineNumber, `tile at cell (${cellX}, ${cellY}) does not fit inside the ${CELLS_X}x${CELLS_Y} cell map`);
            }
            if(parts.length === 5 && parts[4] !== "F") {
                error(path, lineNumber, `unknown tile flag ${parts[4]}`);
            }
            tileLines.push({ tileId, cellX, cellY, flipX: parts.length === 5, level });
        });

        return {
            placements: tileLines.map((placement) => Object.assign(placement, { zOffset, drawOrder })),
            spawns,
        };
    }

    function collectSpawns(spawns) {
        let player = null;
        const enemies = [];
        spawns.forEach((spawn) => {
            if(spawn.x < 0 || spawn.x >= CELLS_X || spawn.y < 0 || spawn.y >= CELLS_Y) {
                error(spawn.path, spawn.lineNumber, `cell (${spawn.x}, ${spawn.y}) is outside the map`);
            }
            if(spawn.kind === "player") {
                if(player) {
                    error(spawn.path, spawn.lineNumber, "duplicate player spawn");
                }
                player = { x: spawn.x, y: spawn.y };
            } else {
                enemies.push({ x: spawn.x, y: spawn.y });
            }
        });
        if(!player) {
            throw new Error("Missing player spawn (P line) in devtools/maps");
        }
        if(!enemies.length) {
            throw new Error("No enemy spawns (E lines) in devtools/maps");
        }
        return { player, enemies };
    }

    function sortPlacements(placements) {
        return placements.slice().sort((left, right) =>
            left.zOffset - right.zOffset || left.cellY - right.cellY || left.cellX - right.cellX);
    }

    function blendOver(data, destination, red, green, blue, alpha) {
        if(alpha === 0) {
            return;
        }
        if(alpha === 255) {
            data[destination] = red;
            data[destination + 1] = green;
            data[destination + 2] = blue;
            data[destination + 3] = 255;
            return;
        }

        const destinationAlpha = data[destination + 3];
        const outputAlpha = alpha + Math.round(destinationAlpha * (255 - alpha) / 255);
        data[destination] = Math.round((red * alpha + data[destination] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
        data[destination + 1] = Math.round((green * alpha + data[destination + 1] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
        data[destination + 2] = Math.round((blue * alpha + data[destination + 2] * destinationAlpha * (255 - alpha) / 255) / outputAlpha);
        data[destination + 3] = outputAlpha;
    }

    function composeMap(sheet, placements) {
        if(sheet.width !== SHEET_COLUMNS * TILE_SIZE || sheet.height !== SHEET_ROWS * TILE_SIZE) {
            throw new Error(`Unexpected spritesheet size: ${sheet.width}x${sheet.height}`);
        }
        const data = new Uint8Array(MAP_PIXELS_X * MAP_PIXELS_Y * 4);
        sortPlacements(placements).forEach((placement) => {
            const source = sheetOffset(placement.tileId);
            const destinationX = placement.cellX * CELL_W;
            const destinationY = placement.cellY * CELL_H - placement.zOffset;
            for(let tileY = 0; tileY < TILE_SIZE; ++tileY) {
                const y = destinationY + tileY;
                if(y < 0 || y >= MAP_PIXELS_Y) {
                    continue;
                }
                for(let tileX = 0; tileX < TILE_SIZE; ++tileX) {
                    const x = destinationX + tileX;
                    if(x < 0 || x >= MAP_PIXELS_X) {
                        continue;
                    }
                    const sourceX = source.x + (placement.flipX ? TILE_SIZE - 1 - tileX : tileX);
                    const sourceIndex = (sourceX + (source.y + tileY) * sheet.width) * 4;
                    const destinationIndex = (x + y * MAP_PIXELS_X) * 4;
                    blendOver(data, destinationIndex, sheet.data[sourceIndex], sheet.data[sourceIndex + 1], sheet.data[sourceIndex + 2], sheet.data[sourceIndex + 3]);
                }
            }
        });
        return { width: MAP_PIXELS_X, height: MAP_PIXELS_Y, data };
    }

    function quantizeToGba(red, green, blue) {
        return [((red >> 3) << 3) | (red >> 5), ((green >> 3) << 3) | (green >> 5), ((blue >> 3) << 3) | (blue >> 5)];
    }

    function indexedPaletteImage(image) {
        const palette = [TRANSPARENT_COLOR.slice()];
        const indexByColor = new Map([[TRANSPARENT_COLOR.join(","), 0]]);
        const data = new Uint8Array(image.width * image.height * 4);
        for(let pixel = 0; pixel < image.width * image.height; ++pixel) {
            const source = pixel * 4;
            let color = TRANSPARENT_COLOR;
            if(image.data[source + 3] !== 0) {
                color = quantizeToGba(image.data[source], image.data[source + 1], image.data[source + 2]);
            }
            const key = color.join(",");
            if(!indexByColor.has(key)) {
                indexByColor.set(key, palette.length);
                palette.push(color);
            }
            const destination = pixel * 4;
            data[destination] = 0;
            data[destination + 1] = color[2];
            data[destination + 2] = color[1];
            data[destination + 3] = color[0];
        }
        if(palette.length > 256) {
            throw new Error(`Palette too big: ${palette.length} colors`);
        }
        return { width: image.width, height: image.height, data, palette };
    }

    function buildCollision(placements) {
        const collision = new Array(CELLS_X * CELLS_Y).fill(false);
        placements.forEach((placement) => {
            if(placement.level === 0 && !BASE_BLOCKING_TILES.has(placement.tileId)) {
                return;
            }
            for(let x = placement.cellX; x < placement.cellX + 2; ++x) {
                for(let y = placement.cellY; y < placement.cellY + 4; ++y) {
                    if(x >= 0 && x < CELLS_X && y >= 0 && y < CELLS_Y) {
                        collision[y * CELLS_X + x] = true;
                    }
                }
            }
        });
        return collision;
    }

    function validateMap(image) {
        let transparent = 0;
        let maxColors = 0;
        for(let tileY = 0; tileY < image.height; tileY += 8) {
            for(let tileX = 0; tileX < image.width; tileX += 8) {
                const colors = new Set();
                for(let y = tileY; y < tileY + 8; ++y) {
                    for(let x = tileX; x < tileX + 8; ++x) {
                        const index = (x + y * image.width) * 4;
                        if(image.data[index + 3] === 0) {
                            ++transparent;
                            colors.add("transparent");
                        } else {
                            colors.add(quantizeToGba(image.data[index], image.data[index + 1], image.data[index + 2]).join(","));
                        }
                    }
                }
                maxColors = Math.max(maxColors, colors.size);
            }
        }
        return { transparent, maxColors };
    }

    function headerText(collision, player, enemies) {
        const lines = [
            "// Generated by devtools/bonka/generate_assets.cjs - do not edit.",
            "// Source maps: devtools/maps/world_l*.map",
            "// World terrain is a 512x512 background tiled on the 16x8",
            "// isometric grid these tiles interlock on.",
            "#ifndef WORLD_MAP_DATA_H",
            "#define WORLD_MAP_DATA_H",
            "",
            "namespace world_map {",
            "",
            "constexpr int PIXELS_X = 512;",
            "constexpr int PIXELS_Y = 512;",
            "constexpr int CELL_W = 16;",
            "constexpr int CELL_H = 8;",
            "constexpr int CELLS_X = 32;",
            "constexpr int CELLS_Y = 64;",
            `constexpr int PLAYER_CELL_X = ${player.x};`,
            `constexpr int PLAYER_CELL_Y = ${player.y};`,
            `constexpr int ENEMY_COUNT = ${enemies.length};`,
            `constexpr int ENEMY_CELL_X[ENEMY_COUNT] = {${enemies.map((enemy) => enemy.x).join(", ")}};`,
            `constexpr int ENEMY_CELL_Y[ENEMY_COUNT] = {${enemies.map((enemy) => enemy.y).join(", ")}};`,
            "namespace detail {",
            "constexpr const bool COLLISION[CELLS_X * CELLS_Y] = {",
        ];
        for(let y = 0; y < CELLS_Y; ++y) {
            const row = [];
            for(let x = 0; x < CELLS_X; ++x) {
                row.push(collision[y * CELLS_X + x] ? "true" : "false");
            }
            lines.push(`    ${row.join(", ")},`);
        }
        lines.push("};", "}", "", "constexpr bool blocked(int cell_x, int cell_y) {", "    if(cell_x < 0 || cell_x >= CELLS_X || cell_y < 0 || cell_y >= CELLS_Y) {", "        return true;", "    }", "    return detail::COLLISION[cell_y * CELLS_X + cell_x];", "}", "", "}", "", "#endif", "");
        return lines.join("\n");
    }

    return {
        BASE_BLOCKING_TILES,
        CELL_H,
        CELL_W,
        CELLS_X,
        CELLS_Y,
        EMPTY_TILE_IDS,
        MAP_PIXELS_X,
        MAP_PIXELS_Y,
        MAX_TILE_ID,
        SHEET_COLUMNS,
        SHEET_ROWS,
        TILE_SIZE,
        TRANSPARENT_COLOR,
        buildCollision,
        collectSpawns,
        composeMap,
        headerText,
        indexedPaletteImage,
        parseLayer,
        quantizeToGba,
        sheetOffset,
        validateMap,
    };
});
