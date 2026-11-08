# AGENTS.md — F1 2026 Aero Development & CFD Lab

This file is the canonical technical briefing for AI coding agents working in this repository (Antigravity, Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Windsurf, Aider). Read this before planning or modifying code.

---

## 1. Project Vision & Current State of the Art

**F1 2026 Aero Development & CFD Lab** is a browser-based 3D Formula 1 aerodynamic engineering and wind-tunnel game built with **Three.js (`^0.174.0`)**, **TypeScript (`^5.7.3`)**, and **Vite (`^6.2.0`)** using zero external UI frameworks.

### What Is Implemented & Working Today
- **Authentic 2026 3D Base Car (`src/geometry/CarModelLoader.ts`):**
  - Default car: **Official FIA 2026 Concept** (`/f1_2026_concept_polygon_model.glb`).
  - Automatic triangle-level spatial classification into **4 spinning wheels** (with live camber/toe/track/rim-dish stance pivots), **static internal cockpit / steering / driver assembly**, and **11 independent deformable FIA 2026 aerodynamic, chassis, and suspension components**, plus a lightweight procedural fallback (`referenceChassis.ts` + `splineSurface.ts`) shown only during the initial ~250 ms GLB stream.
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
- **Real-Time Welded 3D FFD Sculpting, Sub-Zones, Parametric Sliders & Procedural Appendages (`src/geometry/ffdDeformer.ts`, `src/editor/PartSculptor.ts`):**
  - Welded dynamic `BufferGeometry` per part driven by a `+X` half-car `[u][v]` control lattice (`AeroPartData.grid`) using precomputed **top-6 smooth Shepard-Gaussian weights** (`< 8 ms` live deform on the largest mesh).
  - Symmetric bilateral deformation across `X = 0` (`u = 0` locked to `X = 0` when `centerlineLocked = true`) and smooth `seamPinFactor` feathering at chassis junctions so bodywork never tears.
  - **Component Sub-Zones (`PartSubZone`):** Named functional sub-regions per part (e.g., `Inboard Spoon`, `Active Upper Flaps`, `Endplate & Footplate`) selectable via HUD chips or the `sub_zone` selection target.
  - **Parametric Macro Shaping Sliders (`PartParamSlider`):** Engineering sliders (`pitchDeg`, `camberMm`, `flareMm`, `heightMm`) applying smooth macro AoA, camber arch, spanwise outwash flare, and height offsets onto the base lattice (`applyParametricOffsetsToGrid`).
  - **Configurable 3D Procedural Aero Appendages (`ProceduralElementConfig`):** Toggleable, pitchable, scalable, and multi-count 3D appendages (diveplanes, Gurney flaps, brake-duct winglets, vortex fences, cooling louvers, sharkfin extensions, diffuser strakes) welded into the part's FFD & CFD pipeline.
  - **4-Wheel & Axle Stance (`WheelStanceSettings`):** Live front/rear track offset, camber, front toe-in/out, and rim cover dish depth coupled into 3D wheel assemblies and CFD tire wake.
  - 5 selection targets (`node`, `span_rib`, `chord_edge`, `sub_zone`, `whole_part`), 2 gizmo modes (`translate` = Bend/Move, `rotate` = Twist/Pitch), raised-cosine soft-falloff radius, and 40-step Undo/Redo + JSON design export/import.
- **Official FIA 2026 Issue 8 Appendix 1 Legality Boxes (`src/regulations/fia2026.ts`, `src/editor/LegalityVisualizer.ts`):**
  - Tapered 3D frustum Reference Volumes (`LegalityBox`) with sloped vertical & lateral planes and cylindrical wheel-clearance cutouts (`RV-FWEP`).
  - Live surface clamping (`clampPointToLegalityBoxes`) and real-mesh vertex scrutineering (`oobVerts === 0` across all 11 parts at baseline).
- **Coupled 3D Wind-Tunnel CFD & 2026 Active Aerodynamics (`src/cfd/CFDSolver.ts`, `src/cfd/CFDVisualizer.ts`):**
  - Extracts real area-weighted `MacroAeroPanel` patches (`cx, cy, cz, nx, ny, nz, area, su, sv`) directly from the deformed 3D car meshes across all 11 parts + procedural appendages.
  - Models **2026 Active Aerodynamics** (`z_mode` high-downforce cornering vs `x_mode` low-drag straight-line flap flattening on `front_wing` & `rear_wing`), ride-height/rake pitch sensitivity, crosswind yaw, wheel stance tire-wake coupling, Venturi floor throat/diffuser ground effect + stall, front-wing/floor-board tire wake outwash, and upstream-to-downstream wake blanking.
  - Space-marches a `34 × 20 × 60` 3D grid (`vx, vy, vz, cp, turbulence, solid`) driving animated RK2 streamlines, smoke particles, a movable 2D cross-section wake contour slice, surface `Cp` / `Stall` vertex shaders, telemetry KPIs (`CL`, `CD`, `L/D`, `CoP % Front`, 2026 `750 kW` top speed, 240 km/h cornering G), and an actionable Engineering Diagnostics Advisor.
  - **Calibrated Baseline Benchmarks (250 km/h, 0 mm RH, 0° Yaw, FIA 2026 Concept):**
    - `Z-Mode`: `CL ≈ 3.750`, `CD ≈ 0.994`, `L/D ≈ 3.77`, `CoP ≈ 45.8% Front` (inside ideal `44.0%–47.5%` window).
    - `X-Mode`: `CL ≈ 3.166`, `CD ≈ 0.706`, `L/D ≈ 4.48`, `CoP ≈ 47.3% Front`, `Top Speed ≈ 370 km/h`.

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
│   │   └── aero.ts                   # All shared TypeScript interfaces, 11 PartIds, SubZones, Stance, CFDResult
│   ├── regulations/
│   │   └── fia2026.ts                # FIA <-> World transforms, 11-part RV-* boxes, grids, sliders & legality
│   ├── state/
│   │   └── CarProjectStore.ts        # Reactive pub/sub state store, undo/redo, presets, JSON save/load
│   ├── geometry/
│   │   ├── CarModelLoader.ts         # Async GLB loader, 11-part FIA RV segmentation, wheel stance pivots
│   │   ├── ffdDeformer.ts            # PartFFDController: top-6 Shepard-Gaussian 3D FFD, X-Mode deflection, Cp colors
│   │   ├── splineSurface.ts          # Catmull-Rom fallback surface & Cp/separation colormap helpers (cpToRgb)
│   │   └── referenceChassis.ts       # Lightweight procedural chassis shown during initial GLB stream
│   ├── cfd/
│   │   ├── CFDSolver.ts              # Coupled 11-part macro-panel aero physics + 34x20x60 semi-Lagrangian wake solver
│   │   └── CFDVisualizer.ts          # 3D RK2 streamlines, animated flow particles, 2D wake contour slice plane
│   ├── editor/
│   │   ├── SceneManager.ts           # Three.js WebGL scene, lighting, OrbitControls, WASD/Arrow cam
│   │   ├── PartSculptor.ts           # 3D FFD lattice handles, TransformControls gizmo, soft-falloff sculpting
│   │   └── LegalityVisualizer.ts     # 3D CAD wireframe rendering of FIA Reference Volumes (cyan=OK, red=illegal)
│   └── ui/
│       └── HudController.ts          # Categorized 11-part Studio HUD, Sub-Zone chips, sliders, telemetry, hotkeys
├── public/
│   ├── f1_2026_concept_polygon_model.glb                             # Official FIA 2026 Concept 3D mesh
│   └── fia_2026_formula_1_technical_regulations_issue_8_-_2024-06-24.pdf  # Official FIA 2026 Issue 8 PDF
├── docs/
│   ├── ARCHITECTURE.md               # Deep dive: data flow, GLB segmentation, FFD math, performance budgets
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
2. **Preserve Baseline FIA Compliance:** Any change to `src/regulations/fia2026.ts` or `src/geometry/CarModelLoader.ts` must keep `cfdResult.allLegal === true` (`outOfBoundsMeshVertices === 0` across all 11 parts) for the unmodified baseline model.
3. **Protect Interactive Frame Budgets:**
   - `PartFFDController.deform()` runs on pointer-move during gizmo drags — avoid heap allocations inside vertex loops (`Float32Array` / `Uint32Array` only; keep single-part deform `< 10 ms`).
   - `runCFDSimulation()` runs synchronously on throttled gizmo drags and slider inputs — keep full solve `< 25 ms`.
4. **Respect Keyboard Shortcut Allocation:**
   - **Camera Navigation (`SceneManager.ts`):** `W/A/S/D` & `ArrowUp/Left/Down/Right` (horizontal glide), `E`/`PageUp` (up), `Q`/`PageDown` (down), `Shift` (fast sprint). Never bind `W`, `A`, `S`, `D`, `Q`, or `E` to non-camera actions.
   - **Editor & Tunnel Shortcuts (`HudController.ts`):** `G` (Bend/Move gizmo), `R` (Twist/Pitch gizmo), `1–9`, `0`, `-` (select parts `1–11`), `F` (focus active part), `Tab` (toggle Sculpt / Wind Tunnel), `X` (toggle Z-Mode / X-Mode Active Aero), `Ctrl+Z` / `Ctrl+Y` (Undo/Redo).

---

## 5. Deeper Context & Specialized Skills

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) when modifying mesh loading, FFD deformation, state management, or Three.js rendering.
- Read [`docs/CFD_AND_REGULATIONS.md`](./docs/CFD_AND_REGULATIONS.md) when modifying FIA 2026 Reference Volumes, active aero deflections, or CFD physics/diagnostics.
- Read [`docs/ROADMAP.md`](./docs/ROADMAP.md) when planning new game progression mechanics (R&D/ATR caps, track aero correlation, lap-time sim, WebWorker CFD).
- Activate workspace skills in [`.agents/skills/`](./.agents/skills/) (`aero-parts-and-fia-boxes`, `cfd-physics-and-tuning`) for step-by-step domain workflows.
