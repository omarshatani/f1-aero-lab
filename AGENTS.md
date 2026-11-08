# AGENTS.md — F1 2026 Aero Development & CFD Lab

This file is the canonical technical briefing for AI coding agents working in this repository (Antigravity, Claude Code, OpenAI Codex, Cursor, GitHub Copilot, Windsurf, Aider). Read this before planning or modifying code.

---

## 1. Project Vision & Current State of the Art

**F1 2026 Aero Development & CFD Lab** is a browser-based 3D Formula 1 aerodynamic engineering and wind-tunnel game built with **Three.js (`^0.174.0`)**, **TypeScript (`^5.7.3`)**, and **Vite (`^6.2.0`)** using zero external UI frameworks.

### What Is Implemented & Working Today
- **Authentic 2026 3D Base Cars (`src/geometry/CarModelLoader.ts`):**
  - Default car: **Official FIA 2026 Concept** (`/f1_2026_concept_polygon_model.glb`).
  - Switchable car: **Ferrari SF-26** (`/2026_ferrari_sf-26/scene.gltf`) with offscreen UV texture color baking (`TextureColorSampler`) so livery colors survive mesh welding and vertex-colored CFD overlays.
  - Automatic triangle-level spatial classification into **4 spinning wheels**, **static survival cell / halo / wishbones**, and **7 independent deformable FIA 2026 aerodynamic components**, plus a lightweight procedural fallback (`referenceChassis.ts` + `splineSurface.ts`) shown only during the initial ~250 ms GLB stream.
- **7 Independently Deformable FIA 2026 Art. 3 Parts (`PART_ORDER`):**
  1. `front_wing` — Front Wing & Endplate (`Art. 3.10`, `RV-FW` + `RV-FWEP`)
  2. `nosecone` — Nosecone & Cape (`Art. 3.6 / 3.10`, `RV-CH-FRONT`)
  3. `floor_boards` — 2026 Inwashing Floor Boards (`Art. 3.9`, `RV-FB`)
  4. `floor` — Step-Plane Ground-Effect Floor (`Art. 3.5`, `RV-BODY-FLOOR`)
  5. `sidepods` — Sidepod Undercut & Coke-Bottle (`Art. 3.6`, `RV-BODY-SIDE`)
  6. `diffuser` — Rear Floor Diffuser (`Art. 3.5.5`, `RV-DIFF`)
  7. `rear_wing` — Beamless 3-Element Active Rear Wing (`Art. 3.11`, `RV-RW`)
- **Real-Time Welded 3D FFD Sculpting (`src/geometry/ffdDeformer.ts`, `src/editor/PartSculptor.ts`):**
  - Welded dynamic `BufferGeometry` per part driven by a `+X` half-car `[u][v]` control lattice (`AeroPartData.grid`) using precomputed **top-6 smooth Shepard-Gaussian weights** (`< 8 ms` live deform on the largest mesh).
  - Symmetric bilateral deformation across `X = 0` (`u = 0` locked to `X = 0` when `centerlineLocked = true`) and smooth `seamPinFactor` feathering at monocoque/chassis junctions so bodywork never tears away from the survival cell.
  - 4 selection targets (`node`, `span_rib`, `chord_edge`, `whole_part`), 2 gizmo modes (`translate` = Bend/Move, `rotate` = Twist/Pitch), raised-cosine soft-falloff radius, and 40-step Undo/Redo + JSON design export/import.
- **Official FIA 2026 Issue 8 Appendix 1 Legality Boxes (`src/regulations/fia2026.ts`, `src/editor/LegalityVisualizer.ts`):**
  - Tapered 3D frustum Reference Volumes (`LegalityBox`) with sloped vertical & lateral planes and cylindrical wheel-clearance cutouts (`RV-FWEP`).
  - Live surface clamping (`clampPointToLegalityBoxes`) and real-mesh vertex scrutineering (`oobVerts === 0` across all 7 parts at baseline).
- **Coupled 3D Wind-Tunnel CFD & 2026 Active Aerodynamics (`src/cfd/CFDSolver.ts`, `src/cfd/CFDVisualizer.ts`):**
  - Extracts real area-weighted `MacroAeroPanel` patches (`cx, cy, cz, nx, ny, nz, area, su, sv`) directly from the deformed 3D car meshes.
  - Models **2026 Active Aerodynamics** (`z_mode` high-downforce cornering vs `x_mode` low-drag straight-line flap flattening on `front_wing` & `rear_wing`), ride-height/rake pitch sensitivity, crosswind yaw, Venturi floor throat/diffuser ground effect + stall, front-wing/floor-board tire wake outwash, and upstream-to-downstream wake blanking.
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
│   │   └── aero.ts                   # All shared TypeScript interfaces, PartId, LegalityBox, CFDResult
│   ├── regulations/
│   │   └── fia2026.ts                # FIA <-> World transforms, RV-* boxes, baseline grids, clamping & legality
│   ├── state/
│   │   └── CarProjectStore.ts        # Reactive pub/sub state store, undo/redo, presets, JSON save/load
│   ├── geometry/
│   │   ├── CarModelLoader.ts         # Async GLB/GLTF loader, FIA RV segmentation, texture baking, wheel pivots
│   │   ├── ffdDeformer.ts            # PartFFDController: top-6 Shepard-Gaussian 3D FFD, X-Mode deflection, Cp colors
│   │   ├── splineSurface.ts          # Catmull-Rom fallback surface & Cp/separation colormap helpers (cpToRgb)
│   │   └── referenceChassis.ts       # Lightweight procedural chassis shown during initial GLB stream
│   ├── cfd/
│   │   ├── CFDSolver.ts              # Coupled macro-panel aero physics + 34x20x60 semi-Lagrangian wake solver
│   │   └── CFDVisualizer.ts          # 3D RK2 streamlines, animated flow particles, 2D wake contour slice plane
│   ├── editor/
│   │   ├── SceneManager.ts           # Three.js WebGL scene, lighting, OrbitControls, WASD/Arrow cam, model swap
│   │   ├── PartSculptor.ts           # 3D FFD lattice handles, TransformControls gizmo, soft-falloff sculpting
│   │   └── LegalityVisualizer.ts     # 3D CAD wireframe rendering of FIA Reference Volumes (cyan=OK, red=illegal)
│   └── ui/
│       └── HudController.ts          # Topbar, Sculpt & Wind-Tunnel left panels, telemetry right panel, hotkeys
├── public/
│   ├── f1_2026_concept_polygon_model.glb                             # Default FIA 2026 Concept 3D mesh
│   ├── 2026_ferrari_sf-26/                                           # Switchable Ferrari SF-26 GLTF + textures
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
2. **Preserve Baseline FIA Compliance:** Any change to `src/regulations/fia2026.ts` or `src/geometry/CarModelLoader.ts` must keep `cfdResult.allLegal === true` (`outOfBoundsMeshVertices === 0` across all 7 parts) for the unmodified baseline models.
3. **Protect Interactive Frame Budgets:**
   - `PartFFDController.deform()` runs on pointer-move during gizmo drags — avoid heap allocations inside vertex loops (`Float32Array` / `Uint32Array` only; keep single-part deform `< 10 ms`).
   - `runCFDSimulation()` runs synchronously on throttled gizmo drags and slider inputs — keep full solve `< 25 ms`.
4. **Respect Keyboard Shortcut Allocation:**
   - **Camera Navigation (`SceneManager.ts`):** `W/A/S/D` & `ArrowUp/Left/Down/Right` (horizontal glide), `E`/`PageUp` (up), `Q`/`PageDown` (down), `Shift` (fast sprint). Never bind `W`, `A`, `S`, `D`, `Q`, or `E` to non-camera actions.
   - **Editor & Tunnel Shortcuts (`HudController.ts`):** `G` (Bend/Move gizmo), `R` (Twist/Pitch gizmo), `1–7` (select part), `F` (focus active part), `Tab` (toggle Sculpt / Wind Tunnel), `X` (toggle Z-Mode / X-Mode Active Aero), `Ctrl+Z` / `Ctrl+Y` (Undo/Redo).

---

## 5. Deeper Context & Specialized Skills

- Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) when modifying mesh loading, FFD deformation, state management, or Three.js rendering.
- Read [`docs/CFD_AND_REGULATIONS.md`](./docs/CFD_AND_REGULATIONS.md) when modifying FIA 2026 Reference Volumes, active aero deflections, or CFD physics/diagnostics.
- Read [`docs/ROADMAP.md`](./docs/ROADMAP.md) when planning new game progression mechanics (R&D/ATR caps, track aero correlation, lap-time sim, WebWorker CFD).
- Activate workspace skills in [`.agents/skills/`](./.agents/skills/) (`aero-parts-and-fia-boxes`, `cfd-physics-and-tuning`) for step-by-step domain workflows.
