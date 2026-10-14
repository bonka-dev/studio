# Changelog

## v0.3.0

### 🚀 Features

- **project-format:** Add Project Format v1 schemas, multi-file loading and cross-resource validation.
- **editor:** Add browser-hosted project create, open, save and close workflows.
- **tileset:** Import PNG tilesets and edit standalone metatiles across multiple tilesets.
- **scene:** Add isometric layer painting, groups, objects, generic entities and undo/redo history.
- **gba:** Add the Project-v1 GBA generator with deduplicated 8x8 BPP8 tile banks and generated map headers.
- **starter:** Add an asset-free Project Format v1 starter project.

### 🐛 Bug Fixes

- **gba:** Correct BPP8 map tile IDs and 32x32 screenblock map ordering.
- **gba:** Preserve whole-metatile flips, visibility and opacity in generated scene output.
- **editor:** Improve isometric brush snapping, interpolation, canvas ordering and visual markers.

### 📖 Documentation

- Document Project Format v1, the dependency architecture, generated-output policy, third-party notices and future plugin licensing.

### 📦 Build

- Generate disposable Project-v1 Butano inputs exclusively below `.bonka/`.
- Add reproducible editor build and browser acceptance coverage through Docker.

### 🏡 Maintenance

- Replace the legacy `devtools/bonka` implementation with the package-based editor, Core, Project Format and GBA target layout.
- Remove obsolete root graphics and map placeholders.

## v0.2.0

### 🚀 Features

- **gba:** Add blank Butano integration and Bonka asset generator

### 📖 Documentation

- Document the Bonka-to-Butano asset pipeline and Docker development workflow

### 📦 Build

- **assets:** Generate disposable Butano build assets from Bonka scenes in gitignored `.bonka/`

## v0.1.0

### 🚀 Features

- **editor:** Initial browser-based editor for isometric tilemaps
- **canvas:** Isometric map editing on a 32 × 64 cell grid
- **tileset:** Searchable tile palette with custom tileset import
- **metatile:** Configurable metatile editor with collision markers
- **scene:** Layer, group, and object management with in-editor positioning
- Layer visibility, opacity, and offset controls
- **editor:** Tile, object, spawn point, selection, and erase tools
- **history:** Undo and redo history
- **viewport:** Zoom, pan, fit-to-viewport, grid, and tile-footprint controls
- **scene:** Scene import and export as JSON
- **export:** Per-layer map, background, tileset, and tilemap exports for GBA workflows
- **devtools:** Local Node.js server
- **pwa:** Standalone browser metadata

### 📖 Documentation

- Local setup and editor startup instructions
- Roadmap for project format, reusable assets, export, and Nuxt migration

### 🏡 Maintenance

- GNU GPL v3.0 or later license
