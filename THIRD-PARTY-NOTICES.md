# Third-Party Notices

This record captures the dependency-license review for the v0.3 release
candidate. It is not legal advice.

## Butano

`vendor/butano` is distributed under the zlib License; see
`vendor/butano/LICENSE`. It is GPL-3.0-or-later compatible.

## npm Dependencies

The root `package-lock.json` was reviewed on 2026-10-11. The direct v0.3
dependencies are all permissively licensed:

| Package | Locked version | License |
| --- | --- | --- |
| `ajv` | 8.20.0 | MIT |
| `@nktkas/bmp` | 1.3.0 | MIT |
| `pngjs` | 7.0.0 | MIT |
| `esbuild` | 0.25.12 | MIT |

AJV's locked transitive dependencies are MIT except `fast-uri` 3.1.8, which
is BSD-3-Clause. Esbuild's platform-specific optional packages are MIT. These
licenses are GPL-3.0-or-later compatible.

## Generated Output

`packages/target-gba` emits only project-specific images, JSON, map data and
headers below a project's `.bonka/` directory. It does not copy Bonka GPL
implementation code into generated output. See `GENERATED-OUTPUT-POLICY.md`.
