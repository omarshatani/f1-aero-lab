# F1 2026 Aero Development & CFD Lab

An interactive 3D **Formula 1 2026 Aerodynamic Development & Wind-Tunnel CFD** engineering game built with **Three.js**, **TypeScript**, and **Vite**.

Sculpt and bend all seven FIA 2026 aerodynamic bodywork assemblies on real 2026 Formula 1 3D models inside official **FIA Issue 8 Appendix 1 Reference Volumes**, then test your aero package in a coupled **3D Wind-Tunnel CFD solver** with live **Z-Mode / X-Mode Active Aerodynamics**, surface pressure (`Cp`) & boundary-layer separation maps, RK2 3D streamlines, and a movable 2D wake slice.

---

## Current Features (State of the Art)

- **Official FIA 2026 3D Base Models:**
  - **FIA 2026 Official Concept** (`f1_2026_concept_polygon_model.glb`, default)
  - **Ferrari SF-26** (`2026_ferrari_sf-26/scene.gltf`, switchable live in the top bar with UV-baked livery preservation)
- **Independent Free-Form Sculpting Across All 7 FIA Art. 3 Components:**
  1. **Front Wing & Endplate** (`Art. 3.10` · `RV-FW` / `RV-FWEP`)
  2. **Nosecone & Cape** (`Art. 3.6 / 3.10` · `RV-CH-FRONT`)
  3. **Floor Boards** (`Art. 3.9` · `RV-FB` — 2026 inwashing wake-control boards)
  4. **Step-Plane Floor** (`Art. 3.5` · `RV-BODY-FLOOR`)
  5. **Sidepods & Engine Cover** (`Art. 3.6` · `RV-BODY-SIDE`)
  6. **Rear Diffuser** (`Art. 3.5.5` · `RV-DIFF`)
  7. **Beamless Active Rear Wing** (`Art. 3.11` · `RV-RW`)
- **FIA 2026 Legality Boxes & Clamping:** 3D CAD Reference Volume wireframes (tapered frustums + front wheel cutout) with optional hard clamping to keep bent surfaces legal to the millimeter, or unclamped free-sculpting with real-time scrutineering violation alerts.
- **Interactive 3D Wind Tunnel & CFD Telemetry:**
  - Coupled surface macro-panel physics + `34 × 20 × 60` semi-Lagrangian space-marching 3D wake field.
  - **2026 Active Aerodynamics (`Z-Mode` Cornering vs `X-Mode` Straight-Line)**, airspeed (`100–360 km/h`), front & rear ride-height rake offsets, and cornering crosswind yaw (`-6°` to `+6°`).
  - Live `CL`, `CD`, `L/D`, `CoP % Front` aero-balance gauge, 2026 `750 kW` top-speed & `240 km/h` cornering-G projections, baseline pinning (`±Δ` comparisons), and an **Engineering Diagnostics & Improvement Advisor**.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Launch development server (http://localhost:5173/)
npm run dev

# 3. Type-check and build production bundle
npm run build
```

---

## Controls & Shortcuts

| Input | Action |
| :--- | :--- |
| **Left Mouse Drag** (on canvas) | Orbit 3D camera around target |
| **Right Mouse Drag** / **Middle Scroll** | Pan camera / Zoom in & out |
| **`W` `A` `S` `D`** or **Arrow Keys** | Glide camera horizontally (Forward / Left / Back / Right) |
| **`E` / `Q`** (or **`PageUp` / `PageDown`**) | Raise / lower camera elevation |
| **`Shift`** (hold while moving) | `2.25×` fast camera sprint |
| **Click Control Node** / **`1`–`7`** | Select 3D FFD control node / Switch active FIA 2026 part |
| **`G`** / **`R`** | Switch 3D gizmo between **Bend / Move (`G`)** and **Twist / Pitch (`R`)** |
| **`F`** (or double-click part card) | Smoothly focus camera on active aero component |
| **`Tab`** | Switch between **CAD Sculpt Studio** and **Wind Tunnel CFD** |
| **`X`** | Toggle FIA 2026 Active Aerodynamics (**Z-Mode** ↔ **X-Mode**) |
| **`Ctrl+Z`** / **`Ctrl+Y`** | Undo / Redo sculpting modifications (40-step stack) |

---

## AI-Assisted Development Setup

This repository is structured so AI coding agents immediately understand the current architecture, FIA coordinate transforms, physics calibration, and roadmap:

- **[`AGENTS.md`](./AGENTS.md)** — Canonical always-on briefing (supported by Antigravity, OpenAI Codex, Cursor, Windsurf, GitHub Copilot, Aider).
- **[`CLAUDE.md`](./CLAUDE.md)**, **[`.github/copilot-instructions.md`](./.github/copilot-instructions.md)**, **[`.cursor/rules/f1-aero-lab.mdc`](./.cursor/rules/f1-aero-lab.mdc)** — Tool-specific entrypoints aligned with `AGENTS.md`.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — Mesh segmentation, Shepard-Gaussian 3D FFD math, reactive store, and frame-time budgets.
- **[`docs/CFD_AND_REGULATIONS.md`](./docs/CFD_AND_REGULATIONS.md)** — Official FIA 2026 Issue 8 Reference Volume mapping (`fiaMmToWorld`) and 3D CFD solver formulation.
- **[`docs/ROADMAP.md`](./docs/ROADMAP.md)** — Planned R&D game loop, ATR wind-tunnel restrictions, track correlation, and technical next steps.
- **[`.agents/skills/`](./.agents/skills/)** — Progressive-disclosure domain runbooks (`aero-parts-and-fia-boxes`, `cfd-physics-and-tuning`).

---

## Credits & Licenses

- **Source Code:** Licensed under the [Apache License 2.0](./LICENSE).
- **3D Models (CC-BY-4.0):**
  - This work uses *"F1 2026 concept (polygon model)"* ([Sketchfab](https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42)) by **Qvist_designs** ([profile](https://sketchfab.com/Qvist_Designs)), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).
  - This work uses *"2026 Ferrari SF-26"* ([Sketchfab](https://sketchfab.com/3d-models/2026-ferrari-sf-26-e5ca6cecdc42449283f4bed27360f2a7)) by **Dave Love SketchFab** ([profile](https://sketchfab.com/Tyler_Dave)), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).
- **Regulations Reference:** FIA 2026 Formula 1 Technical Regulations (Issue 8, 2024-06-24) included in `public/` for educational/engineering reference.
