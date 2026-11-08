# Project Roadmap — F1 2026 Aero Development Game

This document tracks completed milestones and the planned progression from a pure **Aero CAD + Wind-Tunnel CFD Sandbox** into a full **Formula 1 Aerodynamic R&D Management & Engineering Simulation**.

---

## Completed Milestones

- [x] **Phase 1 — Interactive 3D Aero Sandbox & Wind Tunnel MVP:**
  - Independent part sculpting with symmetric control lattices, FIA legality box clamping, real-time 3D CFD wake grid, RK2 streamlines, wake slice plane, and engineering telemetry HUD.
- [x] **Phase 2 — Official FIA 2026 Models, Welded 3D FFD & Issue 8 Regulations:**
  - Async GLB/GLTF pipeline loading the **Official FIA 2026 Concept** (default) and **Ferrari SF-26** (switchable with UV texture color baking).
  - Exact **FIA 2026 Issue 8 Appendix 1 Reference Volumes (`RV-*`)** with tapered frustums and front-wheel cutouts across all 7 Art. 3 components (`front_wing`, `nosecone`, `floor_boards`, `floor`, `sidepods`, `diffuser`, `rear_wing`).
  - Welded Shepard-Gaussian 3D FFD with monocoque seam pinning, real deformed mesh macro-panel CFD extraction, **Z-Mode / X-Mode 2026 Active Aerodynamics**, and smooth **WASD + Arrow** 3D camera flight.

---

## Planned Next Phases

### Phase 3 — Fine-Grained Local Sculpting & Multi-Spec Comparison
- **Sub-Element Flap & Vane Controls:** Dedicated local FFD/parametric handles for individual front-wing flap elements, endplate diveplanes, floor-edge wing/fences, and diffuser strakes.
- **A/B Aero Spec Overlay & Delta Wind Tunnel:** Side-by-side or ghosted 3D overlay comparing Baseline Spec vs. Candidate Spec with differential `ΔCp` surface heatmaps (`Cp_candidate - Cp_baseline`).
- **Aero Map Sweep Generator:** Automated pitch/heave/yaw matrix run (`FRH × RRH × Yaw`) producing 2D contour plots of `CL` sensitivity and corner-entry CoP migration.

### Phase 4 — F1 Aero Department R&D Loop (ATR & Cost Cap Gameplay)
- **FIA Aerodynamic Testing Restrictions (ATR):** Limited **Wind-Tunnel Hours** and **CFD Teraflop/Run Quotas** per 8-week ATR period (sliding handicap scale based on Constructor Championship standing).
- **Manufacturing & Cost Cap ($):** Composite layup lead times, wind-tunnel scale-model fabrication vs. full-scale autoclave production, crash spares, and FIA Cost Cap accounting.
- **Upgrade Packages & Scrutineering Events:** Bundle sculpted parts into race-weekend upgrade specs (e.g., *Imola High-DF Floor*, *Monza Low-Drag Rear Wing*) subject to pre-race FIA laser-scan scrutineering.

### Phase 5 — Track Aero Correlation & Quasi-Steady Lap-Time Simulator
- **2026 Circuit Profiles:** High-downforce (Monaco, Budapest), aero-efficiency (Silverstone, Suzuka, Spa), and straight-line X-Mode circuits (Monza, Baku, Las Vegas).
- **Point-Mass / Two-Track Lap-Time Solver:** Simulate full-lap sector times using the player's actual `Z-Mode` & `X-Mode` aero maps, ride-height compression vs. speed (suspension heave spring stiffness), porpoising risk on bumps, and 2026 `350 kW` MGU-K energy deployment/harvesting.
- **Wind-Tunnel-to-Track Correlation Variance:** Realistic sensor noise (flow-vis paint, kiel-probe rakes, floor pressure taps) requiring track testing to validate wind-tunnel predictions.

### Phase 6 — Technical & Performance Scaling
- **WebWorker / WebGPU CFD Offload:** Move `CFDSolver.ts` (and higher-resolution `96 × 48 × 160` Lattice-Boltzmann or Vortex-Lattice solvers) off the main UI thread into a dedicated WebWorker or WebGPU compute pipeline.
- **Code-Splitting:** Lazy-load `GLTFLoader` and heavy secondary assets via dynamic `import()` to keep initial bundle size under 500 kB.
