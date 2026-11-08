# FIA 2026 Regulations & CFD Physics Reference

This document explains how **FIA 2026 Formula 1 Technical Regulations (Issue 8)** and the **coupled 3D Wind-Tunnel CFD solver** are modeled in `src/regulations/fia2026.ts` and `src/cfd/CFDSolver.ts`.

---

## 1. FIA 2026 Coordinate & Reference Volume System (`src/regulations/fia2026.ts`)

### Datum Constants
- **Wheelbase (`FIA_WHEELBASE_MM`):** `3400.0 mm` (`3.40 m`, reduced from 3600 mm in 2022–2025).
  - Front Axle (`X_F = 0 mm`) → World `Z = -1.70 m`.
  - Rear Axle (`X_R = 0 mm`, `X_F = 3400 mm`) → World `Z = +1.70 m`.
- **Max Car Width:** `1900 mm` (`Y_FIA ∈ [-950, +950] mm`, `World X ∈ [-0.95, +0.95] m`, reduced from 2000 mm).
- **Vertical Reference Plane (`Z_FIA = 0 mm`):** Sits `30.8 mm` above the wind-tunnel rolling road (`Y = 0`), i.e. `FIA_TIRE_CONTACT_Z_MM = -30.8`.
- **2026 Narrower Tire Envelopes & Stance (`DEFAULT_WHEEL_STANCE`):**
  - Front wheel: radius `0.359 m` (`Ø718 mm`), width `0.335 m`, lateral center `X = 0.764 m`.
  - Rear wheel: radius `0.359 m` (`Ø718 mm`), width `0.426 m`, lateral center `X = 0.728 m`.
  - Configurable via `WheelStanceSettings`: `frontTrackOffsetMm` (`-40..+40 mm`), `rearTrackOffsetMm` (`-40..+40 mm`), `frontCamberDeg` (`-4.5..0°`), `rearCamberDeg` (`-3.5..0°`), `frontToeDeg` (`-1.5..+1.5°`), and `rimCoverDishMm` (`-25..+25 mm`).

### Tapered Frustum Reference Volumes (`LegalityBox`)
Each `LegalityBox` defines a convex 3D frustum on the `+X` half-car (mirrored across `X = 0`) parameterized longitudinally along `t = (z - minZ) / (maxZ - minZ) ∈ [0, 1]`:
- Lateral bounds interpolate linearly: `[minX(t), maxX(t)]` from `[minXFront, maxXFront]` to `[minXRear, maxXRear]`.
- Vertical bounds interpolate linearly: `[minY(t), maxY(t)]` from `[minYFront, maxYFront]` to `[minYRear, maxYRear]`.
- Optional `wheelCutout` excludes points inside a cylinder `(z - axleZ)² + (y - axleY)² < radius²` outboard of `minX` (used on `RV-FWEP` for front tire clearance).

### 11-Part Component-to-Regulation Mapping

| # | `PartId` | Category | FIA 2026 Ref | Reference Volumes | Aero Role (`SurfaceRole`) | Centerline Locked |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `front_wing` | `aero` | Art. 3.10 | `RV-FW-PROFILES` + `RV-FWEP` (1800 mm 3-element active wing + endplate/footplate) | `wing` | Yes (`u=0` at `X=0`) |
| 2 | `nosecone` | `aero` | Art. 3.7.1 | `RV-NOSE` + `RV-FW-PYLON` (tapered impact fairing, twin pylons & under-nose cape) | `body_fairing` | Yes |
| 3 | `front_suspension` | `suspension` | Art. 3.13 / 10 | `RV-SUSP-FRONT` (front carbon wishbone shrouds & brake cooling ducts/deflectors) | `suspension` | No (`X > 0.14 m`) |
| 4 | `monocoque` | `body` | Art. 3.6 / 12 | `RV-CHASSIS` (survival cell tub, cockpit coaming, titanium Halo & mirror pods) | `chassis_body` | Yes |
| 5 | `floor_boards` | `aero` | Art. 3.5.4 | `RV-FLOOR-BOARD` + `RV-FLOOR-FOOT` (2026 outboard 3-slat wake deflectors & footplate) | `wake_board` | No (`X > 0.56 m`) |
| 6 | `floor` | `aero` | Art. 3.5.1 | `RV-FLOOR-BIB` + `RV-FLOOR-BODY` (tea-tray bib, step-plane Venturi underbody & lateral edge) | `ground_effect` | Yes |
| 7 | `sidepods` | `aero` | Art. 3.8 | `RV-SIDEPOD` + `RV-EC` (radiator intake lip, lower undercut & rear coke-bottle waist) | `body_fairing` | No (`X > 0.035 m`) |
| 8 | `engine_cover` | `body` | Art. 3.8.2 | `RV-EC-SHARKFIN` (roll-hoop airbox intake, dorsal sharkfin spine & exhaust tailcone) | `chassis_body` | Yes |
| 9 | `rear_suspension` | `suspension` | Art. 3.13 / 10 | `RV-SUSP-REAR` (rear wishbones, pullrod/driveshaft shrouds & RBD upwash winglets) | `suspension` | No (`X > 0.07 m`) |
| 10 | `diffuser` | `aero` | Art. 3.5.1 / 3.9 | `RV-FLOOR-BODY` + `RV-TAIL` (rear expansion tunnels & central crash boat-tail keel) | `diffuser` | Yes |
| 11 | `rear_wing` | `aero` | Art. 3.11 | `RV-RW-PROFILES` + `RV-RWEP-BODY` + `RV-RW-PYLON` (beamless 3-element active rear wing) | `wing` | Yes |

### Sub-Zones, Parametric Shaping & Procedural Appendages
- **Functional Sub-Zones (`PartSubZone`):** Every part defines 3–4 named sub-zones mapping to subsets of `uIndices` and `vIndices` on the FFD lattice so engineers can isolate specific aerodynamic features (e.g., `Inboard Spoon`, `Active Upper Flaps`, `Endplate & Footplate` on `front_wing`).
- **Parametric Macro Shaping (`applyParametricOffsetsToGrid`):** Each part exposes 3 tailored engineering sliders (`pitchDeg`, `camberMm`, `flareMm`, `heightMm`) that apply chordwise AoA rotation, mid-chord camber arch, spanwise outwash flare, or vertical trim on top of the manual base lattice while respecting FIA Reference Volume clamping.
- **Procedural Aero Elements (`ProceduralElementConfig`):** Parts include toggleable 3D appendages (`fw_diveplane`, `fw_gurney`, `nose_cape_vanes`, `fsusp_duct_winglet`, `mono_halo_boomerang`, `fb_aux_slat`, `floor_fences`, `floor_edge_scroll`, `sp_cooling_louvers`, `ec_sharkfin_ext`, `rsusp_upwash_winglets`, `diff_strakes`, `diff_gurney`, `rw_gurney`) with configurable incidence (`pitchDeg`), chord/span scale (`scale`), and element count (`count`).

### Legality Functions
- `signedMarginInBox(pt, box)`: Returns signed distance in meters (`>= 0` inside frustum & outside wheel cutout; `< 0` violation depth).
- `signedMarginInUnion(pt, boxes)`: Returns `max_i signedMarginInBox(pt, boxes[i])` across a part's union of Reference Volumes.
- `clampPointToLegalityBoxes(pt, boxes, lockCenterX)`: Projects any candidate control node or surface point onto the nearest legal point across the box union.

---

## 2. Coupled 3D Wind-Tunnel CFD Formulation (`src/cfd/CFDSolver.ts`)

`runCFDSimulation()` executes a two-stage solver designed for `< 20 ms` interactive turnaround while capturing real Formula 1 multi-element aerodynamic coupling across all 11 components:

### Stage 1: Coupled Surface Macro-Panel Aerodynamics
1. **Panel Extraction & Ride-Height Transform:**
   - Consumes `MacroAeroPanel[]` extracted from the deformed procedural 3D car mesh across all 11 parts via `PatchEvaluator.extractMeshPanelsAndLegality()`. Triangles on the starboard (`+X`) half-car are isolated, with double-skin shell areas normalized by 2.0 to evaluate true projected planform area matching the underlying control spline within 1%–10%.
   - Incorporates procedural aero appendages (diveplanes, Gurney flaps, strakes) and wheel stance adjustments.
   - Applies pitch/heave via `applyRideHeightTransform(pt, frontRideHeightM, rearRideHeightM)` around the `3.40 m` wheelbase, plus freestream crosswind yaw `β = yawAngleDeg`.
2. **Upstream-to-Downstream Aero Coupling Pass:**
   - **Front Wing Outwash, Front Suspension & Tire Wake Mitigation:** Evaluates spanwise normal tilt (`nx`) and outboard footplate arch on `front_wing`, downwash conditioning from `front_suspension`, and inwashing `floor_boards` incidence to compute how effectively turbulent front-tire wake (modulated by `wheelStance`) is deflected away from the `floor` leading edge and `sidepods` undercut.
   - **Ground-Effect Venturi Floor & Diffuser Coupling:** Tracks minimum floor throat ride height (`h_min`), longitudinal rake, sidepod undercut mass-flow feeding, and `diffuser` expansion ratio (`A_exit / A_throat`). Models ground-effect suction amplification (`∝ 1 / h_eff`) AND catastrophic **porpoising / choking stall** if `h_min` drops below critical ground clearance (`< ~18 mm`) or if diffuser ramp angle exceeds critical adverse-pressure-gradient separation (`> ~19°`).
   - **Monocoque, Engine Cover, Rear Suspension & Beamless Rear Wing Conditioning:** Evaluates `monocoque` / Halo wake, `sidepods` undercut/coke-bottle inward sweep, `engine_cover` sharkfin yaw stability, and `rear_suspension` upwash winglets feeding clean high-energy flow into the `diffuser` roof and `rear_wing` cascade, while accounting for upstream stall wake blanking.
   - **2026 Active Aerodynamics (`z_mode` vs `x_mode`):**
     - `z_mode` (Cornering): Full flap incidence on `front_wing` and `rear_wing` (`CL ≈ 3.769`, `CD ≈ 0.994`, `CoP ≈ 45.7% Front`).
     - `x_mode` (Straight-Line): Reduces movable flap effective angle of attack and induced/profile drag on both `front_wing` and `rear_wing` simultaneously so aero balance (`CoP % Front`) shifts by `< 2%` while shedding `~27%` total drag (`CL ≈ 3.112`, `CD ≈ 0.729`, `Top Speed ≈ 366.4 km/h`).
3. **Force Integration & Vehicle Projections:**
   - Integrates downforce (`N`), drag (`N`), and pitch moment about front/rear axles across both symmetric halves (`× 2`), adding calibrated 2026 narrower open-wheel drag/lift and wheel-stance delta contributions.
   - Normalizes coefficients with ISA sea-level air density `ρ = 1.225 kg/m³` and 2026 frontal reference area `A_ref = 1.45 m²`.
   - Computes terminal straight-line speed (`P_PU ≈ 750 kW` 2026 MGU-K + ICE combined power against aero drag + tire rolling resistance) and sustained lateral acceleration at `240 km/h` (`m_car = 768 kg` 2026 minimum weight + driver).

### Stage 2: 3D Space-Marching Semi-Lagrangian Wake Grid (`CFDGridField`)
- Allocates a `34 × 20 × 60` (`40,800`-cell) 3D Cartesian wind-tunnel domain covering `X ∈ [-1.45, +1.45] m`, `Y ∈ [0.0, 1.65] m`, `Z ∈ [-3.35, +3.45] m`.
- Inlines bilinear and trilinear interpolation weights and slice-filters rotating wheel interactions to eliminate 390,000+ redundant calculations per solve, cutting wake solver execution time by ~50%.
- Marks solid body & rotating tire voxels (`solid: Uint8Array`), injects `PanelInfluence` impulse kernels (`dvx, dvy, dvz, dcp, dturb`) from every deformed aero macro-panel and wheel wake, and marches longitudinally from `k = 0` (`-Z` inlet) to `k = nz - 1` (`+Z` diffuser wake) using semi-Lagrangian upstream advection + turbulent eddy diffusion + ground/body no-penetration projection.
- `CFDVisualizer.ts` samples this field via trilinear interpolation (`sampleCFDField`) to integrate 3D RK2 streamlines, animate convecting flow particles, and render the interactive 2D `XY` wake contour plane at arbitrary `Z`.

---

## 3. Calibration Targets & Sanity Ranges

When modifying `CFDSolver.ts` or `PatchEvaluator.ts`, ensure the unmodified **Procedural 2026 F1 Baseline** at standard wind-tunnel datum (`250 km/h`, `0 mm` FRH/RRH, `0°` Yaw) stays within realistic 2026 F1 engineering windows:

| Metric | `Z-Mode` Target Window | `X-Mode` Target Window |
| :--- | :--- | :--- |
| **Total Downforce (`CL`)** | `3.55 – 3.95` (current: `3.769`) | `2.95 – 3.30` (current: `3.112`) |
| **Total Drag (`CD`)** | `0.94 – 1.06` (current: `0.994`) | `0.66 – 0.76` (current: `0.729`) |
| **Aero Efficiency (`L/D`)** | `3.60 – 3.95` (current: `3.79`) | `4.15 – 4.70` (current: `4.27`) |
| **Aero Balance (`CoP % Front`)** | `44.0% – 47.5%` (current: `45.7%`) | `44.5% – 48.0%` (current: `47.0%`) |
| **2026 Est. Top Speed** | `328 – 336 km/h` | `362 – 374 km/h` (current: `366.4 km/h`) |
| **Baseline Legality (`allLegal`)** | `true` (`0` violating vertices across all 11 parts) | `true` (`0` violating vertices across all 11 parts) |
