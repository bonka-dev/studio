# Architecture

Bonka is a public, GBA-focused development environment. Butano remains the GBA
framework below Bonka; Bonka does not replace it.

## Current packages

| Path | Responsibility | License |
| --- | --- | --- |
| `apps/editor` | Browser-hosted project authoring UI | GPL-3.0-or-later |
| `packages/core` | Project loading, validation and graph checks | GPL-3.0-or-later |
| `packages/cli` | Future migration and command-line tooling | GPL-3.0-or-later |
| `packages/target-gba` | Future PC-side Project-v1 to Butano generator | GPL-3.0-or-later |
| `packages/project-format` | Project-v1 specification and JSON Schemas | Apache-2.0 |
| `packages/sdk` | Future public helper API | Apache-2.0 |
| `packages/protocol` | Future external target/plugin protocol | Apache-2.0 |
| `packages/runtime` | Future game-side C++ runtime | Apache-2.0 |

Only `apps/editor`, `packages/core` and `packages/project-format` currently
contain v0.3 source. Do not create empty SDK, protocol or runtime APIs merely
to fill this layout.

## Dependency direction

```text
apps/editor ──────┐
packages/cli ─────┼──> packages/core ───> packages/project-format
packages/target-gba ┘
```

The editor owns browser APIs and UI state. Core owns validation. The Project
Format package contains no GPL loader or editor implementation. A future
Apache runtime must not import or copy GPL Core or target-generator code.

## Historical code

`devtools/bonka` contains the public v0.1/v0.2 editor and legacy generator.
It remains as release history. v0.3 replacements belong in the package layout;
do not add new v0.3 behavior below `devtools/bonka`.

## Target scope

GBA is the only current build target. The browser is used to host the editor,
not to run games. Three.js/browser-game, desktop and PC targets are future work.
