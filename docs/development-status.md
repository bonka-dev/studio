# Development Status

## Released history

- `v0.1.0`: initial public isometric editor.
- `v0.2.0`: public GBA welcome project and legacy asset-generator foundation.

## v0.3: Project Format v1

The v0.3 workspace boundary is established:

- `apps/editor` contains the browser Project-v1 adapter and editor-state mapping.
- `packages/core` contains the shared Project-v1 loader, validator and public fixtures.
- `packages/project-format` contains the Project-v1 specification and JSON Schemas.
- Root npm workspaces resolve local package dependencies.

These are foundations, not a releasable v0.3 slice yet.

## Deliberately deferred

- Generic migration from legacy Bonka files is out of scope for v0.3. Reassess
  it only after Project Format v1 is stable and its future migrations are known.
- Legacy tests and fixtures still use old paths and game-shaped names; replace
  them with self-contained public fixtures before committing them.
- `devtools/bonka/generate_assets.cjs` is legacy code. Replace it with a
  Project-v1 generator in `packages/target-gba`.
- `devtools/bonka/browser-project.js` is a generated bundle and must not be
  committed as v0.3 source.
- Root Makefile integration waits for the Project-v1 GBA generator.

## Next implementation order

1. Implement the GPL Project-v1 GBA generator.
2. Add a public Project-v1 Butano example and wire its Makefile to `.bonka/`.
3. Integrate open/save into the editor through the shared Core.
4. Audit licenses, provenance, tests and generated output before tagging v0.3.0.
