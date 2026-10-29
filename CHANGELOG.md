# Changelog

## v0.4.0

### 🚀 Features

- **editor:** Migrate the browser editor to Nuxt with a project hub and distinct Map, Entities, Tiles, Animation and Sprites workspaces.
- **sprites:** Add portable layered pixel-sprite authoring, imported sprite-sheet editing, directional sprite sets and reusable entity sprite assignment.
- **project-format:** Add generic Input Map, opaque behavior, prefab, sprite authoring and directional-animation resources.
- **entities:** Add generic entity behavior authoring with directional movement setup, action subscriptions and fixed-point scalar parameters.
- **runtime:** Add an Apache-2.0 game-side GBA helper for generic directional movement, directional clip selection and streamed 8bpp sprite frames.
- **gba:** Generate typed input, behavior, directional sprite, scene-instance and screen-foot depth descriptors for Butano projects.

### 🐛 Bug Fixes

- **gba:** Preserve Butano's `.bonka/build` directory during incremental generation while replacing stale Bonka-generated graphics and headers.
- **gba:** Keep generated game-side headers data-only and remove GPL implementation helpers from generated output.
- **runtime:** Keep the last valid frame visible while a clip change streams, preventing stale prefetches from replacing the requested animation.

### 📖 Documentation

- Document v0.4 sprite streaming, generic input behaviors, sprite asset authoring, runtime plans and the updated architecture boundary.
- Clarify the GPL development-side and Apache-2.0 Project Format and runtime publishing boundary.

### 📦 Build

- Add GitHub Actions CI and GitHub Pages deployment for the Nuxt editor.
- Update the local Butano development integration for generated v0.4 GBA inputs.

### 🏡 Maintenance

- Add the canonical Apache-2.0 license to the game-side runtime.

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
