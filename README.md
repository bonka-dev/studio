# Bonka

Bonka is an experimental browser-based editor and GBA development toolkit.

Version 0.2 adds the first public GBA workflow: an asset generator, and a Docker-based development environment.

## Requirements

- Docker and Docker Compose
- Git
- Game Boy Advance emulator (Optional)

For running the editor outside Docker:

- Node.js 20 or newer

## Install Butano

Bonka expects a local Butano checkout at `vendor/butano/`.

### Clone Butano and start the container

```bash
git clone https://github.com/GValiente/butano.git vendor/butano
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

### Clean and rebuild:

```bash
docker compose exec -T gba make clean
docker compose exec -T gba make
```

It exists to verify the public Bonka, Butano, Docker, and GBA build workflow.
It is not a game runtime and does not contain private game behavior.

## GBA Asset Generator

The asset generator runs on the development machine or in the development container. It transforms the public Bonka scene into disposable Butano build inputs below `.bonka/`.

Generated files are not committed and must not be edited manually.

## Status

Bonka is under active development.

## Roadmap

- Project Format v1
- Reusable assets and entity definitions
- Generic GBA entity generation
- Nuxt editor migration

## License

Bonka is licensed under the GNU General Public License v3.0 or later. See [LICENSE](./LICENSE).

This repository includes a minimal public GBA welcome screen. It does not include a game, game logic, maps, sprites, audio, or other project-specific assets.
