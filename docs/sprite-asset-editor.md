# Sprite Asset Editor

Status: initial Nuxt implementation. The existing Animation workspace has
reached the relevant migration milestone, but it is not this feature.

## Goal

Bonka should provide a focused sprite asset editor inside the main authoring
application. It is not intended to replace Aseprite or become a general-purpose
image editor. Its purpose is to create small, project-owned graphics that can be
selected and used by Bonka resources.

The feature should be implemented after the Nuxt migration so its interface is
built once in the component-based editor instead of first extending the legacy
DOM-driven workspace.

## Workspace

The central workspace currently has two top-level modes:

- Map for the existing scene and level authoring workflow.
- Animation for imported sprite-sheet layout and animation metadata.

The Sprite Asset Editor is a third, separate workspace. Its tab label is
`Sprites`. It must not replace, rename, or otherwise reinterpret Animation.
It should list project sprites, allow selecting one for drawing and provide the
actions needed to create or import a sprite.

## Initial Scope

The first version should support:

- Pixel-accurate drawing on a sprite canvas.
- A selectable color palette suitable for the configured GBA color mode.
- Existing multiple frames and named animations remain managed by Animation.
- Existing per-animation frame order, frame duration and looping remain managed
  by Animation.
- A current drawing layer and a selectable background or reference layer.
- Rendering lower visible layers below the current drawing layer.
- Selecting the resulting sprite graphic for use by other Bonka resources.
- Saving the flattened sprite source image and its animation metadata with the
  project.

The intended pointer controls are:

- Left mouse button draws the selected color on the current layer.
- Right mouse button erases a pixel from the current layer.
- Alt and right mouse button pick the visible composed color beneath the
  pointer, including lower layers.

## Non-Goals

The initial feature does not need to provide:

- A complete Aseprite-compatible workflow.
- Selection, lasso, transform, gradient or dithering tools.
- Complex filters or automatic palette reduction.
- Aseprite file import.
- Game-specific Player, Enemy or behavior semantics.
- A new runtime or non-GBA target.

## Project Format Boundary

Project Format v1 already describes a flattened sprite source image, frame
size, frame count, origin, animations and GBA color settings. It will gain an
optional `authoring` member on sprite documents for portable pixel-source data.
Existing sprite documents without `authoring` remain valid.

`authoring` uses a versioned layer model. Each layer stores source-image pixel
data in portable JSON, with transparent pixels represented by `null`. Reference
layers may retain their native dimensions, position, display opacity and display
scale. The
editor flattens visible drawing layers to the existing PNG at `source`; the PNG
remains the only sprite image consumed by target adapters. A reference layer is
editor-only and is not part of the flattened PNG. Editable authoring data must not be stored below
`.bonka/`, because that directory contains disposable generated output.

Project Format v1 currently connects sprites to reusable entity definitions
through the entity `sprite` component. Ordinary scene objects are generic
markers and do not have a built-in sprite reference. Before exposing a generic
"use this graphic" action, decide whether it should:

- configure the sprite component of an entity definition;
- add an explicitly designed optional sprite reference to scene objects; or
- remain an editor-only preview without changing Project Format v1.

This decision must not hard-code game behavior into Project Format, Core or the
GBA target adapter.

## Decisions

- New drawn sprites use 8x8-aligned frame dimensions. Existing imported sprites
  retain their current permissive validation and can be opened without change.
- Drawing layers are portable sprite-document data. Reference layers are stored
  as editor-only metadata and are never flattened or consumed by target
  adapters.
- The first palette offers canonical GBA BGR555 colors. Transparent is the
  absence of a pixel in a drawing layer, rather than a palette color.
- The GBA target consumes only flattened PNG sprite resources. It generates
  project-specific clip descriptors for the Apache game-side runtime; runtime
  behavior remains generic and contains no Player or movement semantics.

## Implementation Status

1. Complete: Map, Animation and Sprites are distinct workspaces.
2. Complete: portable versioned authoring layers validate in Project Format v1.
3. Complete: the Sprites workspace can create a blank 16x16 sprite or import
   PNG sprites, select an asset, and draw into its layers.
4. Complete: a GBA-compatible 16-color palette, drawing/reference layers and
   draw, erase and composed-color picker controls are available.
5. Complete: visible drawing layers flatten to the existing PNG source when
   edited; reference layers remain excluded.
6. Existing: Map assigns sprite assets through entity definitions' sprite
   component.
7. Pending: browser acceptance coverage for creation, drawing, saving and
   reopening.
