# GitHub Copilot Instructions — F1 2026 Aero Development & CFD Lab

Read [`AGENTS.md`](../AGENTS.md) first for the full repository architecture and current state of the art.

## Key Engineering Rules

1. **Stack:** Vanilla TypeScript (`strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`), Three.js (`^0.174.0`), and Vite (`^6.2.0`). Do not introduce React/Vue or heavy UI libraries unless explicitly requested.
2. **World vs. FIA 2026 Coordinates (`src/regulations/fia2026.ts`):**
   - Three.js World uses meters: `+X` = Starboard lateral (`X = 0` symmetry plane), `+Y` = Vertical above rolling road (`Y = 0` tire contact; FIA `Z_FIA = 0` is `Y = +0.0308 m`), `Z` = Longitudinal (`-Z` = Front nose, `+Z` = Rear wing; Front Axle `Z = -1.70 m`, Rear Axle `Z = +1.70 m`).
   - Always use `fiaMmToWorld(xF, yFia, zFia)` and `worldToFiaMm(pt)` when converting between FIA Issue 8 millimeters and 3D world space.
3. **Symmetry & Legality Invariants:**
   - All 7 deformable parts (`front_wing`, `nosecone`, `floor_boards`, `floor`, `sidepods`, `diffuser`, `rear_wing`) store their FFD control lattice (`grid[u][v]`) and `LegalityBox`es on the `+X` half-car and mirror automatically across `X = 0`.
   - Baseline unmodified cars (`fia_2026_concept` and `ferrari_sf26`) must remain 100% legal (`outOfBoundsMeshVertices === 0`, `cfdResult.allLegal === true`).
4. **Performance & Shortcuts:**
   - Avoid heap allocations inside vertex deformation (`src/geometry/ffdDeformer.ts`) or 3D grid inner loops (`src/cfd/CFDSolver.ts`).
   - Camera movement owns `WASD`, `Arrow` keys, `Q`/`E`, `PageUp`/`PageDown`, and `Shift` (`src/editor/SceneManager.ts`). Gizmo modes use `G` (Move/Bend) and `R` (Twist/Pitch) (`src/ui/HudController.ts`).
5. **Verification:** Always run `npm run build` to ensure zero TypeScript or Vite bundling errors. See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and [`docs/CFD_AND_REGULATIONS.md`](../docs/CFD_AND_REGULATIONS.md) for deep dives.
