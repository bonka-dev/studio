# Bonka Project Format v1

## Status and conformance

This document specifies Bonka Project Format v1. It is the public, Apache-2.0
data boundary between Bonka project authors, editor implementations, and
development-side tooling.

The JSON Schemas in [`schemas/`](./schemas/) are the normative structural
definition of each document. This document defines how those documents relate
to one another and gives the field-level meaning that JSON Schema cannot
express alone. If this document and a schema disagree, the schema takes
precedence until a matching format-version revision is published.

A conforming Project Format v1 document MUST validate against its corresponding
Draft-07 JSON Schema. A conforming project loader MUST also perform the
cross-document checks in [Project graph](#project-graph). Loaders MAY report
additional diagnostics, but MUST NOT reinterpret or add game-specific meaning
to the format.

Project Format v1 describes authored data. It does not define a game runtime,
rendering behaviour, player roles, enemies, combat, or gameplay rules. Its
input-map resource records target controls, but does not define action meaning
or dispatch behavior.

## Conventions

### JSON documents

All format documents are UTF-8 JSON objects. Every document carries
`"formatVersion": 1`. Resource documents also carry a discriminator in their
`type` field. Unknown top-level fields are rejected unless a schema explicitly
allows a free-form `properties` or `overrides` object.

### Identifiers

Every identifier uses lowercase ASCII letters and digits, with single hyphens
between words:

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Identifiers are references, not display names. `name` is the human-readable
label and MUST be non-empty.

### Paths

Paths in `project.resources` are relative to the project document's directory.
Asset paths such as tileset and sprite `source` are relative to the resource
document that contains them. All paths MUST use `/`, MUST NOT be absolute or
drive-qualified, and MUST NOT traverse a parent directory (`..`).
Implementations MUST resolve paths within the project root.

### Coordinates and sizes

`size` objects use `columns` and `rows` for a grid's logical dimensions.
`grid`, `collisionGrid`, scene, tileset, and metatile `tileSize`, and sprite
`frameSize` use pixel dimensions named `width` and `height`.

Cells are zero-based `{ "x": integer, "y": integer }` coordinates. A scene
loader MUST reject placements, objects, and entity instances that lie outside
the scene's `size`. `offset` values are integer pixel offsets and MAY be
negative.

### Provenance

`createdWith` is optional metadata for the Bonka version that last wrote a
document:

```json
{ "bonka": "0.3.0" }
```

It is informational and MUST NOT change interpretation of v1 data.

## Project document

The project document validates against
[`project-v1.schema.json`](./schemas/project-v1.schema.json). It is the root
of a project and contains:

| Field | Meaning |
| --- | --- |
| `formatVersion` | Must be `1`. |
| `name` | Non-empty project display name. |
| `engine` | Must be `"butano"` in v1. |
| `startScene` | Identifier of the scene used as the project's entry scene. |
| `inputMap` | Optional identifier of the selected input-map resource. |
| `resources` | Paths to the project's scene, tileset, metatile, prefab, sprite, entity, and input-map documents. |
| `createdWith` | Optional writer provenance. |

`resources` contains the required arrays `scenes`, `tilesets`, `metatiles`,
`sprites`, and `entities`. A resource path MUST occur no more than once in its
array. `prefabs` is an optional array of visual map-prefab documents; readers
MUST treat an omitted array as empty for existing Project Format v1 projects.
`inputMaps` is likewise optional and treated as empty. When `inputMap` is
present, it MUST resolve to one resource listed by `resources.inputMaps`.

## Input map document

An input map validates against
[`input-map-v1.schema.json`](./schemas/input-map-v1.schema.json) and has
`"type": "inputMap"`. It contains an ID, display name, and an `actions` array.
Each action has a format ID and one or more bindings. Action IDs MUST be unique
within an input map.

Every v1 binding is explicitly a GBA digital binding with `"platform": "gba"`.
`control` is one of `up`, `down`, `left`, `right`, `a`, `b`, `l`, `r`, `start`,
or `select`; `trigger` is `held`, `pressed`, or `released`. This mapping defines
only how a generic action token relates to a physical GBA control. The format
does not assign meaning to action IDs, connect them to Player roles, or define
runtime dispatch and movement behavior.

## Scene document

A scene validates against
[`scene-v1.schema.json`](./schemas/scene-v1.schema.json). Its `type` MUST be
`"scene"`; v1 supports the `"isometric"` orientation only.

| Field | Meaning |
| --- | --- |
| `id`, `name` | Scene identifier and display name. |
| `size` | Logical scene dimensions in cells. |
| `grid` | Pixel dimensions of one logical grid cell. |
| `collisionGrid` | Pixel dimensions used by collision authoring. |
| `tileSize` | Pixel dimensions of one source tile. |
| `tilesets` | Unique tileset identifiers used by placements in this scene. |
| `layers` | Ordered layer tree. |
| `entities` | Entity-definition instances in scene cells. |
| `editor` | Optional editor bookkeeping, with next available numeric counters. |

### Layers

Each layer has an `id`, non-empty `name`, `visible` flag, opacity from `0` to
`1`, integer `order`, and pixel `offset`. `level` is optional integer metadata.

The `type` determines the layer shape:

- `group` contains a nested `layers` array.
- `tile` contains `placements` and `objects` arrays.
- `object` contains `placements` and `objects` arrays.

Layer arrays preserve authoring order. `order` is explicit data for consumers
that need a numeric ordering; the format does not prescribe a renderer's draw
algorithm. Layer IDs MUST be unique throughout a scene, including nested
groups.

A placement references a standalone metatile and supplies a zero-based
destination `cell`. It MAY supply `flip` with boolean `x` and `y` members. An
omitted `flip` means no flip is requested. Every tileset used by the referenced
metatile MUST occur in the scene's `tilesets` array.

An object is generic editor-authored scene data. It has an ID, name, visibility,
and cell. Its optional `properties` object is intentionally unconstrained;
Project Format v1 assigns it no gameplay meaning. Object IDs MUST be unique
throughout a scene.

### Entity instances

An entity instance has an ID, a `definition` reference, and a destination
cell. Its optional `overrides` object is unconstrained data applied by a
consumer that understands the referenced definition. The format defines no
special entity roles. Instance IDs MUST be unique throughout a scene.

## Tileset document

A tileset validates against
[`tileset-v1.schema.json`](./schemas/tileset-v1.schema.json) and has
`"type": "tileset"`.

`source` identifies the tileset image relative to the tileset document.
`tileSize` defines the image tile dimensions. `layout` records the source image
dimensions, column count, tile count, margin, and spacing used to address that
image.

## Metatile document

A metatile validates against
[`metatile-v1.schema.json`](./schemas/metatile-v1.schema.json) and has
`"type": "metatile"`.

Each metatile has an ID, name, source-tile `tileSize`, positive `columns` and
`rows`, visibility, opacity, a `tiles` array, and a `collision` array. Each
`tiles` entry is either `null` for an empty metatile cell or an object containing
a `tileset` resource ID and a zero-based `tile` index. `collision` contains `0`
or `1`, where `1` marks a collision cell and `0` leaves it unmarked. Metatile
IDs MUST be unique throughout the project. A loader MUST verify that `tiles`
and `collision` each contain exactly `columns * rows` entries, every referenced
tileset exists and has the same `tileSize` as the metatile, and each tile index
is below the referenced tileset's `layout.tileCount`.

When placed in a scene, a metatile's composed pixel dimensions MUST match the
scene's `tileSize`: `columns * tileSize.width` equals the scene tile width and
`rows * tileSize.height` equals the scene tile height.

## Prefab document

A visual map prefab validates against
[`prefab-v1.schema.json`](./schemas/prefab-v1.schema.json) and has
`"type": "prefab"`. It has an ID, display name, positive `columns` and `rows`,
and `placements`. Each placement references a metatile at a zero-based cell
within the prefab. A cell may have at most one placement. Prefabs contain no
entities, objects, collision overrides, or gameplay semantics.

## Sprite document

A sprite validates against
[`sprite-v1.schema.json`](./schemas/sprite-v1.schema.json) and has
`"type": "sprite"`.

`source` identifies the image relative to the sprite document. `frameSize` and
`frameCount` define its authored frames. `origin`, when present, is an integer
pixel origin. `animations` maps format identifiers to animations. Each
animation has a `loop` flag and a non-empty sequence of frames; each frame
supplies a zero-based frame `index` and a positive `duration`. A loader MUST
verify that animation frame indices are less than `frameCount`.

`layout`, when present, describes how frames are arranged in an imported sprite
sheet. It records the source image dimensions, grid `columns` and `rows`, and
non-negative pixel `margin` and `spacing` offsets. Frames are addressed
left-to-right, then top-to-bottom. A loader MUST verify that all declared
frames fit inside that grid and image. Documents without `layout` remain valid;
consumers may treat their frames as one horizontal strip with no margin or
spacing.

An animation MAY provide its own `layout`. This captures the grid, margin and
spacing used when that animation was authored, allowing separate animations to
address different regions of one source sheet. Its frame indices are resolved
against that animation's layout; otherwise they use the sprite layout.

`directionalSets`, when present, defines named directional animation groups.
Each set has a format ID and one or more variants. A variant explicitly maps an
animation ID to an angle in degrees from `0` inclusive to `360` exclusive, and
may include an editor-only label. IDs and angles must be unique within their
respective sets, and every referenced animation must exist. The format does not
require a particular number of directions: four, six, eight, or other authored
sets are valid. Consumers may select the nearest variant for a direction; this
metadata does not impose Player or movement behavior.

Angles use a compass convention in screen space: `0` is up, `90` is right,
`180` is down, and `270` is left. Angles increase clockwise. Consumers that
convert vectors to angles MUST use this convention when selecting variants.

`authoring`, when present, contains optional portable source data for the Sprite
Asset Editor. It has `version: 1`, source-image `width` and `height`, and one or
more ordered layers. `palette`, when present, stores the editor's ordered
`#rrggbb` color slots. Every layer has an ID, display name, visibility, `kind`,
and a row-major `pixels` array. The array contains either `null` for a
transparent pixel or a `#rrggbb` color. Drawing layers MUST have exactly
`width * height` pixels. Reference layers MAY provide their own `width` and
`height`, `offset` position, display-only `opacity`, and display-only `scale`;
their pixel array MUST
match that layer's dimensions. Drawing layers are composed from bottom to top
into the flattened PNG identified by `source`; reference layers remain
project-owned authoring data but are excluded from that PNG. Consumers that do
not provide sprite authoring MAY ignore this optional member and use `source`
normally.

The required `gba` object describes source constraints for the GBA target:
`colors` is either `16` or `256`, `bpp` is respectively `4` or `8`, and the
optional `priority` is an integer from `0` to `3`. The schema permits both
color and bpp values independently; a target adapter is responsible for
reporting incompatible target data.

## Entity definition document

An entity definition validates against
[`entity-v1.schema.json`](./schemas/entity-v1.schema.json) and has
`"type": "entity"`. It contains a non-empty `components` object. v1 defines
only these optional components:

| Component | Meaning |
| --- | --- |
| `sprite` | References a sprite `asset` and exactly one presentation mode: either one `animation` identifier or one of the asset's `directionalSet` IDs. |
| `collider` | A box with positive integer `width` and `height`. |
| `behavior` | An opaque behaviour identifier with optional opaque input-action subscriptions and scalar parameters. |

`behavior.id` is a reference token only. It does not define behaviour,
execution, scripting, physical input, physical-input mapping, or any runtime
contract. When present, `behavior.inputActions` is a unique list of format-ID
tokens. It records subscriptions only; it does not assign meanings to actions
or define input, behavior, or dispatch semantics.
`behavior.parameters`, when present, is an object whose values are strings,
finite numbers, or booleans. Parameter names and values are opaque: Project
Format and Core validate and preserve them but assign no meaning to them.

Scene entity instances MAY set `facingAngle` from `0` inclusive to `360`
exclusive. Consumers selecting a directional set may use it to choose the
nearest variant; absent values default to `0`.

## Project graph

After individual schema validation, a loader MUST verify all of the following:

1. Every path in `project.resources` resolves to a document of its corresponding
   type.
2. Resource document IDs are unique within their resource type, including
   globally unique metatile IDs.
3. `project.startScene` resolves to one listed scene.
4. A scene's `tilesets` references resolve to listed tilesets, every placement
   resolves to a listed metatile, and every tileset used by that metatile is
   listed by the scene.
5. Each scene entity instance resolves to a listed entity definition.
6. An entity `sprite.asset` resolves to a listed sprite, and
   `sprite.animation` resolves to an animation in that sprite.
7. Metatile tile references resolve to listed tilesets, use matching tile
   dimensions, and stay below their tileset's tile count.
8. Cells, metatile arrays, and animation frame indices meet the bounds defined
   in this specification.
9. A placed metatile's composed pixel dimensions match the scene's `tileSize`.
10. Every prefab placement resolves to a listed metatile, occupies a unique
    cell, and stays inside its prefab bounds.
11. `project.inputMap`, when present, resolves to a listed input map, and action
    IDs are unique within each input map.

These checks belong to a loader or validator implementation, not to the
Apache-2.0 format package's schemas.

## Compatibility

Readers MUST reject a document whose `formatVersion` is not `1`. Writers that
change required fields, their interpretation, or identifier and path rules
MUST publish a new format version. Optional metadata may be added only where
the relevant schema permits it.
