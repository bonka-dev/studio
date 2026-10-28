# Bonka

Bonka is an experimental browser-based editor and GBA development toolkit.

It provides a browser-hosted editor, Project Format v1 validation and a
GBA-focused generator for Butano.

The browser editor has separate Map, Animation and Sprites workspaces. Animation
edits imported sprite-sheet layouts and metadata; Sprites draws project-owned
pixel assets. The two workflows remain separate.

## Requirements

- Docker and Docker Compose for the recommended workflow
- Git
- Game Boy Advance emulator (Optional)

For local development without Docker:

- Node.js 20 or newer
- devkitPro with devkitARM
- Make and Python 3

## Docker Setup

Docker is the recommended workflow. The image installs the pinned Butano
release automatically, so no manual Butano checkout is required.

### Start the container

```bash
docker compose up -d --build
```

Open the Bonka editor: http://localhost:8000

### Stop the container when finished

```bash
docker compose down
```

### Build a GBA ROM

```bash
docker compose exec -T gba make
```

The generated ROM is `.bonka/build/bonka_welcome.gba`.

### Clean and rebuild

```bash
docker compose exec -T gba make clean
docker compose exec -T gba make
```

It exists to verify the public Bonka, Butano, Docker, and GBA build workflow.
It is not a game runtime and does not contain private game behavior.

## Local Butano Setup

To build without Docker, clone the same Butano release used by the Docker
image into the ignored `vendor/` directory:

```bash
git clone --branch 21.2.0 --depth 1 https://github.com/GValiente/butano.git vendor/butano
npm ci
npm run build --workspace @bonka/editor
node apps/editor/server.mjs
```

In a second terminal, build the ROM with:

```bash
make
```

`vendor/` is local-only and must not be committed.

## GBA Asset Generator

The asset generator runs on the development machine or in the development container. It transforms the public Bonka scene into disposable Butano build inputs below `.bonka/`.

Generated files are written below `.bonka/`, are not committed and must not be
edited manually.

## Status

Bonka is under active development.

## Current v0.4 Development

The current development slice adds reusable directional sprite authoring and an
opt-in streamed 8bpp GBA sprite path:

- The **Entities** workspace defines reusable entities, project Input Maps and
  generic behavior data. Its Directional Movement setup writes ordinary entity
  data with D-pad actions, screen or isometric movement, diagonal normalization,
  and idle/walk directional sprite sets.
- A game-side integration can resolve that generic data for a
  `directional-movement` behavior. It can move configured scene entities with
  fixed-point values, preserve facing while idle, and change clips without
  gameplay roles in Project Format, Core, the generator, or the Apache runtime.
- The runtime streams individual 8bpp animation frames through a shared OBJ
  tile cache, shared palette allocator and VBlank upload pipeline. Interactive
  clip changes take priority over ambient prefetches, and actors are sorted by
  screen-foot depth in one shared sprite layer.

Read the feature details and current boundaries in
[`docs/v0.4-sprite-streaming.md`](docs/v0.4-sprite-streaming.md) and
[`docs/v0.4-input-behaviors.md`](docs/v0.4-input-behaviors.md).

## v0.3 Workspace

Project Format v1 development is organized into explicit package boundaries:

- `apps/editor`: GPL-licensed browser authoring application.
- `packages/core`: GPL-licensed project loading and validation.
- `packages/project-format`: Apache-licensed Project Format schemas and specification.
- `packages/target-gba`: GPL-licensed Project-v1 to Butano generator.

## License

Bonka is licensed under the GNU General Public License v3.0 or later. See [LICENSE](./LICENSE).

This repository includes an asset-free Project-v1 starter project and a
minimal public GBA text welcome screen. It does not include private game code,
maps, sprites, audio or other project-specific assets.
