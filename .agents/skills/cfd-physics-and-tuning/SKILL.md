---
name: cfd-physics-and-tuning
description: >-
  Use this skill when modifying, calibrating, or extending the 3D Wind-Tunnel CFD
  solver, Z-Mode / X-Mode Active Aerodynamics, surface Cp / stall maps, 3D RK2
  streamlines, wake contour slices, or engineering diagnostics.
---

# Modifying & Calibrating the 3D Wind-Tunnel CFD Pipeline

Follow this workflow when editing [`src/cfd/CFDSolver.ts`](../../../src/cfd/CFDSolver.ts) or [`src/cfd/CFDVisualizer.ts`](../../../src/cfd/CFDVisualizer.ts).

## 1. Architecture of a Single CFD Solve (`runCFDSimulation`)
1. **Input Geometry (`MacroAeroPanel[]`):**
   - `SceneManager.extractActiveMeshCFDData()` calls `PartFFDController.extractDeformedMacroPanels()` on all 7 deformed 3D meshes (`+X` half-car centroids `cx, cy, cz`, outward unit normals `nx, ny, nz`, chordwise tangents `tx, ty, tz`, true area `area`, and normalized `su, sv ∈ [0, 1]`).
   - Always maintain the spline fallback path in `CFDSolver.ts` (`meshPanels?.[partId]`) so the initial synchronous store boot (before async GLB finishes) succeeds cleanly.
2. **Upstream-to-Downstream Aero Coupling:**
   - Freestream flows along **`+Z`** (`vz ≈ +V_inf`, with crosswind `vx` from `yawAngleDeg`), and ground sits at **`Y = 0`**.
   - A downward force (`-Y`) is **positive Downforce** (`downforceN > 0`); a rearward force (`+Z`) is **positive Drag** (`dragN > 0`).
   - Keep component interactions physically coupled:
     - `front_wing` outwash + `floor_boards` inwash → reduces front-tire turbulent wake ingestion into `floor` and `sidepods`.
     - `floor` minimum throat height (`applyRideHeightTransform`) + `diffuser` expansion angle → governs Venturi suction peak AND low-ride-height choking / high-angle separation stall.
     - `activeAeroMode === 'x_mode'` → simultaneously flattens `front_wing` and `rear_wing` upper elements so drag drops ~28–30% while `copFrontPct` stays balanced within `~1.5%` of `z_mode`.
3. **3D Wake Field (`CFDGridField`):**
   - `34 × 20 × 60` grid (`nx × ny × nz`) indexed via `(k * ny + j) * nx + i`.
   - Keep `runCFDSimulation()` under **25 ms** on CPU with zero inner-loop object allocations so live gizmo sculpting stays smooth.

## 2. Calibration Guardrails (FIA 2026 Concept @ 250 km/h, 0 mm RH, 0° Yaw)
After any physics change, verify baseline numbers stay inside realistic 2026 F1 wind-tunnel bounds:
- **`Z-Mode` (Cornering):** `CL ∈ [3.55, 3.95]`, `CD ∈ [0.94, 1.06]`, `L/D ∈ [3.60, 3.95]`, `CoP ∈ [44.0%, 47.5%]` Front.
- **`X-Mode` (Straight-Line):** `CL ∈ [2.95, 3.30]`, `CD ∈ [0.66, 0.76]`, `L/D ∈ [4.25, 4.70]`, `CoP ∈ [44.5%, 48.0%]` Front, `topSpeedEstKmh ∈ [365, 378]`.
- **Directional Monotonicity Checks:**
  - Pitching rear wing steeper (`G`/`R` gizmo) must increase `rear_wing` `CL` & `CD` and move `copFrontPct` rearward (lower `%`).
  - Lowering ride height moderately (`-8 mm`) must increase `floor` `CL`, whereas slamming the floor into the ground (`-18 mm` with drooped floor center) must trigger choking/porpoising stall diagnostics.

## 3. Verification
1. Run `npm run build` to verify strict TypeScript compilation and Vite bundling.
2. Check `CFDVisualizer.ts` (`velocity`, `pressure`, `turbulence` streamline modes + 2D `XY` wake slice) and `AeroDiagnostic[]` cards in `HudController.ts` if new flow metrics were introduced.
