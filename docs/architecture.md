# Architecture

Bonka is a public, GBA-focused development environment. Butano remains the GBA
framework below Bonka; Bonka does not replace it.

## Current packages

| Path | Responsibility | License |
| --- | --- | --- |
| `apps/editor` | Browser-hosted project authoring UI | GPL-3.0-or-later |
| `packages/core` | Project loading, validation and graph checks | GPL-3.0-or-later |
| `packages/cli` | Future migration and command-line tooling | GPL-3.0-or-later |
| `packages/target-gba` | PC-side Project-v1 to Butano generator | GPL-3.0-or-later |
| `packages/project-format` | Project-v1 specification and JSON Schemas | Apache-2.0 |
| `packages/sdk` | Future public helper API | Apache-2.0 |
| `packages/protocol` | Future external target/plugin protocol | Apache-2.0 |
| `packages/runtime` | Butano game-side sprite clip and bank helpers | Apache-2.0 |

`apps/editor`, `packages/core`, `packages/project-format`,
`packages/target-gba` and `packages/runtime` currently contain v0.3 source.
The runtime has an intentionally narrow public sprite API; do not create empty
SDK or protocol APIs merely to fill this layout.

## Publishing Boundary

The root GPL-3.0-or-later license applies to Bonka's development-side code,
including the editor, Core, CLI and official GBA target. The Project Format and
game-side runtime are separate Apache-2.0 works with their own `LICENSE` files:

- `packages/project-format` publishes the specification and JSON Schemas.
- `packages/runtime` publishes generic Butano-facing helpers that may be
  compiled into a project.

Project authors own their assets and project data. Local `assets/`, scenes,
entity definitions, input maps and other project resources are not Bonka tool
source and must not be staged or published as part of a Bonka framework change.
They may be versioned by an author's own project repository. Public examples,
when intentionally published separately, require independently verified asset
provenance and their own explicit license declaration.

## Dependency direction

```text
apps/editor ────────┐
packages/cli ───────┼──> packages/core ───> packages/project-format
packages/target-gba ┘
```

The editor owns browser APIs and UI state. Core owns validation. The Project
Format package contains no GPL loader or editor implementation. The Apache
runtime must not import or copy GPL Core or target-generator code. The GPL GBA
target generates project-specific clip descriptors consumed by the runtime.

The editor's Map workspace owns scene authoring, while its Animation workspace
edits imported sprite-sheet layouts and animation metadata. The separate Sprites
workspace draws project-owned graphics; it must not reinterpret the Animation
workspace as a drawing tool.

The editor may offer game-oriented authoring presets such as Player or Enemy
tools. Such presets must write ordinary entity definitions and instances; they
do not introduce privileged roles or required behavior into Project Format,
Core or a target adapter.

The built-in Directional Movement setup follows the same boundary. It writes an
opaque behavior ID, generic action subscriptions, and scalar parameters to a
reusable entity definition. Input-map resources map those action IDs only to
GBA digital controls; Core validates references but neither Core nor Project
Format interprets movement parameters. Behavior profiles and movement runtime
remain out of scope.

## Target scope

GBA is the only current build target. The browser is used to host the editor,
not to run games. Three.js/browser-game, desktop and PC targets are future work.
