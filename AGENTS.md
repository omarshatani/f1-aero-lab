# AGENTS.md — F1 2026 Aero Development & CFD Lab

This file is the canonical technical briefing for AI coding agents working in this repository (Antigravity, Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Windsurf, Aider). Read this before planning or modifying code.

---

## 1. Project Vision & Current State of the Art

**F1 2026 Aero Development & CFD Lab** is a browser-based 3D Formula 1 aerodynamic engineering and wind-tunnel game built with **Three.js (`^0.174.0`)**, **TypeScript (`^5.7.3`)**, and **Vite (`^6.2.0`)** using zero external UI frameworks.

### What Is Implemented & Working Today
- **100% Procedural Parts-First 2026 Formula 1 Car (`src/surface/PatchEvaluator.ts`, `src/regulations/fia2026.ts`):**
  - **Zero GLB Runtime Dependencies:** 100% procedurally generated from mathematical control lattices (`CageV2`) with zero external polygon meshes or GLTF loading delays.
  - **5 Physical Shared Seams Welded to Exact 0.000000 mm Gap:** Continuous C0 boundary contact across adjacent assemblies (`RV-FW` ↔ `RV-NOSE`, `RV-NOSE` ↔ `RV-CHASSIS`, `RV-CHASSIS` ↔ `RV-EC`, `RV-CHASSIS` ↔ `RV-FLOOR-BIB`, `RV-FLOOR` ↔ `RV-DIFFUSER`).
  - **Two-Tier Control Cages (`CageV2`):** Macro level (coarse engineering handles) and Detail level (dense evaluation handles) with seam synchronization and anti-fold normal protection (`src/editor/constraints.ts`).
- **Two-Tier Adaptive LOD Pipeline (`src/surface/lod.ts`, `src/surface/surfaceWorker.ts`):**
  - **Preview LOD (~31k Triangles, < 15 ms):** Synchronous, zero-allocation main-thread bicubic Catmull-Rom patch tessellation providing fluid 60 FPS feedback during interactive 3D gizmo drags.
  - **Full LOD (~994k Triangles, ~100 ms):** Dedicated WebWorker offloading high-density production tessellation with zero-copy transferable `ArrayBuffer`s, complete with real-time HUD worker status pill.
- **Procedural Vehicle Fixtures & UV-Anchored Appendages (`src/geometry/fixtures.ts`, `src/geometry/proceduralElements.ts`):**
  - **10 Vehicle Fixtures:** 4 spinning wheels (live stance pivots for camber, toe, track offset, rim dish), titanium Halo structure, rearview mirrors, driver helmet & visor, cockpit interior, and exhaust tailpipe, all toggleable via the Studio HUD.
  - **UV-Anchored 3D Appendages:** Diveplanes, Gurney flaps, brake-duct winglets, vortex fences, cooling louvers, sharkfin extensions, and diffuser strakes evaluated in local orthogonal surface frames `(origin, tangentU, tangentV, normal)` riding seamlessly on bodywork deformation.
- **11 Independently Deformable FIA 2026 Full-Car Components (`PART_ORDER`):**
  1. `front_wing` — Front Wing, Endplate & Footplate (`aero`, `Art. 3.10`, `RV-FW` + `RV-FWEP`)
  2. `nosecone` — Nosecone, Cape & Wing Pylons (`aero`, `Art. 3.7.1`, `RV-NOSE` + `RV-FW-PYLON`)
  3. `front_suspension` — Front Suspension & Brake Ducts (`suspension`, `Art. 3.13 / 10`, `RV-FBD`)
  4. `monocoque` — Monocoque Tub, Cockpit, Halo & Mirrors (`body`, `Art. 3.6 / 12`, `RV-CHASSIS`)
  5. `floor_boards` — 2026 Wake-Control Floor Boards (`aero`, `Art. 3.5.4`, `RV-FLOOR-BOARD` + `RV-FLOOR-FOOT`)
  6. `floor` — Main Floor, Bib & Edge Bodywork (`aero`, `Art. 3.5.1`, `RV-FLOOR-BIB` + `RV-FLOOR-BODY`)
  7. `sidepods` — Sidepod Inlet, Undercut & Coke-Bottle (`aero`, `Art. 3.8`, `RV-SIDEPOD` + `RV-EC`)
  8. `engine_cover` — Airbox Roll Hoop, Sharkfin & Tailcone (`body`, `Art. 3.8.2`, `RV-EC-SHARKFIN`)
  9. `rear_suspension` — Rear Suspension & Brake Ducts (`suspension`, `Art. 3.13 / 10`, `RV-RBD`)
  10. `diffuser` — Rear Diffuser & Boat-Tail (`aero`, `Art. 3.5.1 / 3.9`, `RV-FLOOR-BODY` + `RV-TAIL`)
  11. `rear_wing` — Beamless 3-Element Active Rear Wing (`aero`, `Art. 3.11`, `RV-RW` + `RV-RWEP` + `RV-RW-PYLON`)
- **Official FIA 2026 Issue 8 Appendix 1 Legality Boxes (`src/regulations/fia2026.ts`, `src/editor/LegalityVisualizer.ts`):**
  - Tapered 3D frustum Reference Volumes (`LegalityBox`) with sloped vertical & lateral planes and cylindrical wheel-clearance cutouts (`RV-FWEP`).
  - Live surface clamping (`clampPointToLegalityBoxes`) and vertex scrutineering (`oobVerts === 0` across all 11 parts at baseline).
- **Coupled 3D Wind-Tunnel CFD & 2026 Active Aerodynamics (`src/cfd/CFDSolver.ts`, `src/cfd/CFDVisualizer.ts`):**
  - Extracts single-skin area-weighted `MacroAeroPanel` patches (`cx, cy, cz, nx, ny, nz, area, su, sv`) directly from deformed 3D car meshes across all 11 parts + procedural appendages.
  - Models **2026 Active Aerodynamics** (`z_mode` high-downforce cornering vs `x_mode` low-drag straight-line flap flattening on `front_wing` & `rear_wing`), ride-height/rake pitch sensitivity, crosswind yaw, wheel stance tire-wake coupling, Venturi floor throat/diffuser ground effect + stall, front-wing/floor-board tire wake outwash, and upstream-to-downstream wake blanking.
  - Space-marches a `34 × 20 × 60` 3D grid (`vx, vy, vz, cp, turbulence, solid`) in ~19–38 ms driving animated RK2 streamlines, smoke particles, a movable 2D cross-section wake contour slice, surface `Cp` / `Stall` vertex shaders, telemetry KPIs (`CL`, `CD`, `L/D`, `CoP % Front`, 2026 `750 kW` top speed, 240 km/h cornering G), and an actionable Engineering Diagnostics Advisor.
  - **Calibrated Baseline Benchmarks (250 km/h, 0 mm RH, 0° Yaw, Procedural 2026 Car):**
    - `Z-Mode`: `CL ≈ 3.769`, `CD ≈ 0.994`, `L/D ≈ 3.79`, `CoP ≈ 45.7% Front` (inside ideal `44.0%–47.5%` window).
    - `X-Mode`: `CL ≈ 3.112`, `CD ≈ 0.729`, `L/D ≈ 4.27`, `CoP ≈ 47.0% Front`, `Top Speed ≈ 366.4 km/h`.

---

## 2. Coordinate System & FIA 2026 Datum Contract (CRITICAL)

Do **not** mix Three.js World coordinates with FIA Regulation coordinates without going through `fiaMmToWorld()` and `worldToFiaMm()` in `src/regulations/fia2026.ts`.

| Axis / Datum | Three.js World Space (meters) | FIA 2026 Regulations (millimeters) | Notes |
| :--- | :--- | :--- | :--- |
| **Lateral** | **`X`** (`+X` = Starboard / Right, `0` = Symmetry Plane) | **`Y_FIA`** (`yFia = x * 1000`) | Control grids & `LegalityBox`es are authored on `+X` (`x >= 0`) and mirrored across `X = 0`. |
| **Vertical** | **`Y`** (`Y = 0` = Wind Tunnel Rolling Road / Tire Contact) | **`Z_FIA`** (`zFia = y * 1000 - 30.8`) | FIA Reference Plane (`Z_FIA = 0 mm`) sits **`+30.8 mm`** above ground (`Y = +0.0308 m`). |
| **Longitudinal** | **`Z`** (`-Z` = Front / Nose, `+Z` = Rear / Wing) | **`X_F`** (`xF = z * 1000 + 1700`) | Freestream airflow travels **`-Z → +Z`**. |
| **Wheelbase** | Front Axle `Z = -1.70 m`, Rear Axle `Z = +1.70 m` | `X_F = 0 mm` (Front), `X_F = 3400 mm` / `X_R = 0` (Rear) | `FIA_WHEELBASE_MM = 3400.0` (`3.40 m`). |

---

## 3. Repository & Module Map

```text
f1-aero-lab/
├── index.html                        # App shell (#viewport WebGL canvas + #hud-root overlay)
├── src/
│   ├── main.ts                       # Bootstraps CarProjectStore -> SceneManager -> HudController
│   ├── style.css                     # Studio HUD layout, glassmorphism panels, telemetry & KPI styles
│   ├── types/
│   │   └── aero.ts                   # All shared TypeScript interfaces, 11 PartIds, CageV2, SubZones, Stance, CFDResult
│   ├── regulations/
│   │   └── fia2026.ts                # FIA <-> World transforms, 11-part RV-* boxes, fitted cages, seam links & legality
│   ├── state/
│   │   └── CarProjectStore.ts        # Reactive pub/sub state store, undo/redo, presets, V1->V2 migration, JSON save/load
│   ├── surface/
│   │   ├── PatchEvaluator.ts         # Catmull-Rom bicubic surface tessellator, planform area & legality extraction
│   │   ├── surfaceWorker.ts          # Dedicated WebWorker for high-density Full LOD tessellation
│   │   ├── surfaceMath.ts            # Fast matrix inversion, bicubic weights & surface evaluation math
│   │   ├── surfaceTypes.ts           # Worker request/response messaging and transfer buffer interfaces
│   │   └── lod.ts                    # LODManager orchestrating preview LOD (main thread) & full LOD (worker)
│   ├── geometry/
│   │   ├── fixtures.ts               # ProceduralFixturesManager: 4 wheels + 6 static vehicle fixtures
│   │   ├── proceduralElements.ts     # UV-anchored 3D appendages riding parent surface frames
│   │   └── splineSurface.ts          # Fallback spline surface & Cp/separation colormap helpers (cpToRgb)
│   ├── cfd/
│   │   ├── CFDSolver.ts              # Coupled 11-part macro-panel aero physics + 34x20x60 semi-Lagrangian wake solver
│   │   └── CFDVisualizer.ts          # 3D RK2 streamlines, animated flow particles, 2D wake contour slice plane
│   ├── editor/
│   │   ├── SceneManager.ts           # Three.js WebGL scene, lighting, OrbitControls, WASD/Arrow cam, LOD wiring
│   │   ├── PartSculptor.ts           # Two-tier cage handles (macro/detail), TransformControls gizmo, soft falloff
│   │   ├── constraints.ts            # Anti-fold normal dot-product validation & hardpoint locks
│   │   └── LegalityVisualizer.ts     # 3D CAD wireframe rendering of FIA Reference Volumes (cyan=OK, red=illegal)
│   └── ui/
│       └── HudController.ts          # Studio HUD V2, handle level toggle, LOD badge, migration toast, telemetry, hotkeys
├── public/
│   └── fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf  # Official FIA 2026 Issue 8 PDF
├── docs/
│   ├── ARCHITECTURE.md               # Deep dive: procedural pipeline, Catmull-Rom patch math, WebWorker LOD
│   ├── CFD_AND_REGULATIONS.md        # Deep dive: FIA 2026 RV-* boxes, CFD equations, calibration targets
│   └── ROADMAP.md                    # Planned gameplay & simulation phases
└── .agents/skills/                   # On-demand procedural runbooks for AI agents
```

---

## 4. Development Commands & Verification

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server with HMR (default http://localhost:5173/)
npm run build        # Run strict TypeScript check (tsc) + Vite production bundle
npm run preview      # Preview production build locally
```

### Mandatory Pre-Completion Checks
1. **Always run `npm run build`** after any TypeScript or CSS change. `tsconfig.json` enforces `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, and `noFallthroughCasesInSwitch: true` — unused variables or implicit `any` will fail the build.
2. **Preserve Baseline FIA Compliance:** Any change to `src/regulations/fia2026.ts` or `src/surface/PatchEvaluator.ts` must keep `cfdResult.allLegal === true` (`outOfBoundsMeshVertices === 0` across all 11 parts) for the unmodified baseline model.
3. **Protect Interactive Frame Budgets:**
   - `PatchEvaluator.evaluatePartSurface()` runs on pointer-move during gizmo drags for Preview LOD — keep main-thread single-part preview update `< 5 ms` (full car `< 15 ms`).
   - `runCFDSimulation()` runs synchronously on throttled gizmo drags and slider inputs — keep full solve `< 25 ms` (warmed up: ~19–38 ms).
4. **Respect Keyboard Shortcut Allocation:**
   - **Camera Navigation (`SceneManager.ts`):** `W/A/S/D` & `ArrowUp/Left/Down/Right` (horizontal glide), `E`/`PageUp` (up), `Q`/`PageDown` (down), `Shift` (fast sprint). Never bind `W`, `A`, `S`, `D`, `Q`, or `E` to non-camera actions.
   - **Editor & Tunnel Shortcuts (`HudController.ts`):** `G` (Bend/Move gizmo), `R` (Twist/Pitch gizmo), `M` (Toggle Macro / Detail handle level), `1–9`, `0`, `-` (select parts `1–11`), `F` (focus active part), `Tab` (toggle Sculpt / Wind Tunnel), `X` (toggle Z-Mode / X-Mode Active Aero), `Ctrl+Z` / `Ctrl+Y` (Undo/Redo).

---

## 5. Deeper Context & Specialized Skills

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) when modifying mesh loading, FFD deformation, state management, or Three.js rendering.
- Read [`docs/CFD_AND_REGULATIONS.md`](./docs/CFD_AND_REGULATIONS.md) when modifying FIA 2026 Reference Volumes, active aero deflections, or CFD physics/diagnostics.
- Read [`docs/ROADMAP.md`](./docs/ROADMAP.md) when planning new game progression mechanics (R&D/ATR caps, track aero correlation, lap-time sim, WebWorker CFD).
- Activate workspace skills in [`.agents/skills/`](./.agents/skills/) (`aero-parts-and-fia-boxes`, `cfd-physics-and-tuning`) for step-by-step domain workflows.
