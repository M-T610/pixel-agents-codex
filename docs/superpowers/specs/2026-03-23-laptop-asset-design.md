# Laptop Furniture Asset Design

Date: 2026-03-23

## Goal

Add a new laptop furniture asset that fits the current Pixel Agents aesthetic and behaves like the existing `PC` asset family.

The laptop should feel native to the current asset set rather than introducing a new visual language or runtime behavior model.

## Scope

### In Scope

- a new `LAPTOP` furniture asset family
- PC-style orientation variants
- PC-style `on` and `off` state behavior
- three separate color variants exposed as separate catalog items
- surface placement behavior compatible with desks and similar furniture

### Out Of Scope

- a new runtime behavior system for electronics
- manual per-item recoloring UI for laptops
- new furniture placement rules
- changing the existing electronics animation system
- redesigning the furniture catalog structure

## Current Asset Context

The current furniture system supports:

- manifest-driven asset families
- grouped orientation/state/animation variants
- mirrored side variants
- surface-placeable electronics

The closest existing reference is `PC`, which already defines:

- `electronics` category
- `canPlaceOnSurfaces: true`
- directional variants
- animated `on` frames
- static `off` frame

Small decor props like `COFFEE` are structurally simpler, but they are not the right model for this asset because the requested behavior is explicitly PC-like.

## Design Decisions

### Family Shape

Add the laptop as a `LAPTOP` family under `webview-ui/public/assets/furniture/LAPTOP`.

The asset should be:

- category: `electronics`
- `canPlaceOnSurfaces: true`
- `canPlaceOnWalls: false`
- `footprintW: 1`
- `footprintH: 1`

This keeps the asset compatible with the current electronics placement model and matches the requested `1x1` footprint expectation.

### Variant Strategy

The laptop should expose three separate catalog items:

- beige
- graphite
- silver

These are separate placeable items, not one item with runtime tinting and not one item with a later manual color selector requirement.

All three variants should use the same underlying model silhouette and behavior. The differences should be limited to authored palette and minor accent treatment, not shape changes.

### State Behavior

The laptop should behave like the current `PC` asset:

- `on` state is animated
- `off` state is open with a dark screen
- no separate closed-shut state

This keeps it aligned with the existing office “working electronics” language and avoids introducing a parallel state model.

### Orientation Behavior

The laptop should follow the PC-style directional setup:

- front
- back
- side
- mirrored side handling where appropriate

This ensures the asset reads correctly from different desk placements without requiring a special-case renderer.

## Visual Direction

The laptop should feel like a compact retro office machine rather than a sleek ultrabook.

Visual rules:

- chunky silhouette first, detail second
- thick base and clearly readable hinge
- compact open-screen profile
- minimal keyboard detail
- high-contrast shading with one light face, one midtone, and one deep shadow
- restrained screen accent in the `on` state

Color guidance:

- beige variant should feel warm and retro
- graphite should feel darker and slightly more modern without breaking the set
- silver should feel cool gray, still stylized and pixel-retro

All three should preserve the same outer form so they read as finish variants of one product family.

## Naming And Manifest Structure

The asset should use a PC-like naming pattern with explicit per-color variants.

Example naming direction:

- `LAPTOP_BEIGE_FRONT_OFF`
- `LAPTOP_BEIGE_FRONT_ON_1`
- `LAPTOP_BEIGE_FRONT_ON_2`
- `LAPTOP_BEIGE_FRONT_ON_3`
- `LAPTOP_BEIGE_BACK`
- `LAPTOP_BEIGE_SIDE`

and the same pattern for:

- `GRAPHITE`
- `SILVER`

Recommended manifest structure:

- one `LAPTOP` folder
- one manifest
- grouped rotation/state/animation tree
- three sibling color subfamilies inside the same family

This keeps the asset family together while still exposing separate catalog items.

## Approaches Considered

### Approach 1: PC-Style Laptop Family With Separate Color Entries

Create a single `LAPTOP` family that contains three color variants, each with PC-style orientation and state behavior.

Pros:

- best fit with current asset conventions
- easiest to reason about for future contributors
- preserves explicit authored visuals
- keeps runtime behavior predictable

Cons:

- more sprite work than a single recolorable asset

### Approach 2: Single Neutral Laptop Plus Runtime Recoloring

Author one laptop model and rely on recoloring/tinting later.

Pros:

- fewer authored sprites

Cons:

- does not match the current explicit PC-family style
- weaker art control over each finish
- pushes unnecessary UI/runtime complexity into a simple asset addition

### Approach 3: Three Fully Separate Laptop Families

Create independent beige, graphite, and silver laptop families.

Pros:

- straightforward file-level separation

Cons:

- more duplication
- less cohesive asset organization
- noisier catalog/manifest maintenance

## Decision

Adopt Approach 1.

Implement one `LAPTOP` family with three separate color variants, all using the same model shape and PC-style orientation/state behavior.

## Implementation Shape

Implementation should be done in four slices:

1. Create the `LAPTOP` asset directory and manifest.
2. Author the sprite set for beige, graphite, and silver variants.
3. Rebuild assets and verify the laptop appears as separate catalog items.
4. Smoke-test placement, orientation, and `on/off` animation behavior.

## Testing

Verification should focus on practical behavior:

- manifest loads without asset-loader warnings
- all laptop entries appear in the furniture catalog
- each variant can be placed on supported surfaces
- front/back/side variants resolve correctly
- mirrored side behavior works
- animated `on` frames load correctly
- static `off` frame loads correctly
- extension and standalone builds continue to load furniture assets normally

## Success Criteria

The design is successful if:

- the laptop reads as native to the current office asset set
- it behaves like the existing PC family
- the three color variants are clearly distinct but still one model family
- the asset fits existing manifest/runtime conventions without special-case code
