---
name: aero-parts-and-fia-boxes
description: >-
  Use this skill when adding, modifying, or debugging aerodynamic car components,
  FFD control lattices, GLB/GLTF mesh segmentation, or FIA 2026 Issue 8 Appendix 1
  Reference Volume legality boxes.
---

# Modifying Aero Parts, Mesh Segmentation & FIA 2026 Boxes

Follow this workflow whenever changing part definitions, FFD control grids, FIA Reference Volumes, or 3D GLTF triangle classification.

## 1. Understand the Coordinate Transform First
All FIA 2026 Technical Regulation dimensions in [`src/regulations/fia2026.ts`](../../../src/regulations/fia2026.ts) are authored in **FIA millimeters** via `makeFiaBox(...)` and `fiaMmToWorld(xF, yFia, zFia)`:
- `xF` (`mm`): Longitudinal (`0` = Front Axle -> World `Z = -1.70 m`; `3400` = Rear Axle -> World `Z = +1.70 m`).
- `yFia` (`mm`): Lateral on starboard `+X` half-car (`0` = symmetry plane -> `World X = 0`; `950` = max floor/body half-width -> `World X = +0.95 m`).
- `zFia` (`mm`): Vertical above FIA Reference Plane (`0` -> `World Y = +0.0308 m`; `-30.8` = Wind Tunnel Rolling Road `World Y = 0`).

## 2. Files to Update in Lockstep
If you modify a part's bounds or add a new `PartId`:
1. [`src/types/aero.ts`](../../../src/types/aero.ts): Update `PartId` union if adding/renaming a component.
2. [`src/regulations/fia2026.ts`](../../../src/regulations/fia2026.ts):
   - Update `PART_ORDER`.
   - Define/adjust `LegalityBox[]` using `makeFiaBox(...)` (supports sloped `zMinFront -> zMinRear`, `zMaxFront -> zMaxRear`, tapered `yMinFront -> yMinRear`, `yMaxFront -> yMaxRear`, and `wheelCutoutFia`).
   - Ensure every baseline control node `grid[u][v]` in `createBaselineParts()` (and presets in `createPresetGrids()`) satisfies `signedMarginInUnion(pt, legalityBoxes) >= 0`, with `grid[0][v].x === 0` whenever `centerlineLocked === true`.
3. [`src/geometry/CarModelLoader.ts`](../../../src/geometry/CarModelLoader.ts):
   - Check `classifyTriangleBucket(...)`: a mesh triangle is assigned to `partId` **only if all 3 vertices** satisfy `signedMarginInUnion(v, part.legalityBoxes) >= -0.005`.
   - Check `computeSeamPinFactor(...)` so vertices bordering `static_chassis` stay smoothly pinned (`seamPinFactor -> 1`) and do not rip open gaps when bent.
4. [`src/editor/SceneManager.ts`](../../../src/editor/SceneManager.ts) & [`src/ui/HudController.ts`](../../../src/ui/HudController.ts):
   - Add a `focusPart` camera preset in `SceneManager.focusPart()` and verify number-key selection (`1..N`) in `HudController.bindKeyboardShortcuts()`.

## 3. Mandatory Verification
1. Run `npm run build` (`tsc && vite build`) and ensure `0` TypeScript errors.
2. Verify that both **`fia_2026_concept`** and **`ferrari_sf26`** load with `cfdResult.allLegal === true` and `outOfBoundsMeshVertices === 0` on every part in `PART_ORDER` before any user sculpting occurs.
