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
rendering behaviour, input, player roles, enemies, combat, or target-specific
gameplay rules.

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
`grid`, `collisionGrid`, `tileSize`, and sprite `frameSize` use pixel
dimensions named `width` and `height`.

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
| `resources` | Paths to the project's scene, tileset, sprite, and entity documents. |
| `createdWith` | Optional writer provenance. |

`resources` contains the required arrays `scenes`, `tilesets`, `sprites`, and
`entities`. A resource path MUST occur no more than once in its array.

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

A placement references a scene tileset and one of its metatiles, and supplies
a zero-based destination `cell`. It MAY supply `flip` with boolean `x` and `y`
members. An omitted `flip` means no flip is requested.

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

Each metatile has an ID, name, positive `columns` and `rows`, visibility,
opacity, a `tiles` array, and a `collision` array. `tiles` contains either a
zero-based source-tile index or `null` for an empty metatile cell. `collision`
contains `0` or `1`, where `1` marks a collision cell and `0` leaves it
unmarked. Metatile IDs MUST be unique within a tileset. A loader MUST verify
that `tiles` and `collision` each contain exactly `columns * rows` entries and
that source-tile indices are below `layout.tileCount`.

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
| `sprite` | References a sprite `asset` and one of its `animation` identifiers. |
| `collider` | A box with positive integer `width` and `height`. |
| `behavior` | An opaque behaviour identifier. |

`behavior.id` is a reference token only. It does not define behaviour,
execution, scripting, or any runtime contract.

## Project graph

After individual schema validation, a loader MUST verify all of the following:

1. Every path in `project.resources` resolves to a document of its corresponding
   type.
2. Resource document IDs are unique within their resource type.
3. `project.startScene` resolves to one listed scene.
4. A scene's `tilesets` references resolve to listed tilesets, and every
   placement references a tileset listed by that scene and a metatile from it.
5. Each scene entity instance resolves to a listed entity definition.
6. An entity `sprite.asset` resolves to a listed sprite, and
   `sprite.animation` resolves to an animation in that sprite.
7. Cells, metatile arrays, and animation frame indices meet the bounds defined
   in this specification.

These checks belong to a loader or validator implementation, not to the
Apache-2.0 format package's schemas.

## Compatibility

Readers MUST reject a document whose `formatVersion` is not `1`. Writers that
change required fields, their interpretation, or identifier and path rules
MUST publish a new format version. Optional metadata may be added only where
the relevant schema permits it.
