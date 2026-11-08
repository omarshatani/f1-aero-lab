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
- **2026 Narrower Tire Envelopes (`FIA_2026_WHEELS`):**
  - Front wheel: radius `0.359 m` (`Ø718 mm`), width `0.335 m`, lateral center `X = 0.764 m`.
  - Rear wheel: radius `0.359 m` (`Ø718 mm`), width `0.426 m`, lateral center `X = 0.728 m`.

### Tapered Frustum Reference Volumes (`LegalityBox`)
Each `LegalityBox` defines a convex 3D frustum on the `+X` half-car (mirrored across `X = 0`) parameterized longitudinally along `t = (z - minZ) / (maxZ - minZ) ∈ [0, 1]`:
- Lateral bounds interpolate linearly: `[minX(t), maxX(t)]` from `[minXFront, maxXFront]` to `[minXRear, maxXRear]`.
- Vertical bounds interpolate linearly: `[minY(t), maxY(t)]` from `[minYFront, maxYFront]` to `[minYRear, maxYRear]`.
- Optional `wheelCutout` excludes points inside a cylinder `(z - axleZ)² + (y - axleY)² < radius²` outboard of `minX` (used on `RV-FWEP` for front tire clearance).

### Component-to-Regulation Mapping

| `PartId` | FIA 2026 Ref | Reference Volumes | Aero Role (`SurfaceRole`) | Centerline Locked |
| :--- | :--- | :--- | :--- | :--- |
| `front_wing` | Art. 3.10 | `RV-FW` (3-element narrower 1800 mm profile) + `RV-FWEP` (endplate + diveplane) | `wing` | Yes (`u=0` at `X=0`) |
| `nosecone` | Art. 3.6 / 3.10 | `RV-CH-FRONT` (sloped forward survival cell / nose / cape) | `body_fairing` | Yes |
| `floor_boards` | Art. 3.9 | `RV-FB` (2026 3-slat inwashing wake control boards aft of front wheel) | `wake_board` | No (`X > 0.45 m`) |
| `floor` | Art. 3.5 | `RV-BODY-FLOOR` (flatter 2026 step-plane floor + floor fences, `Y_FIA ≤ 950 mm`) | `ground_effect` | Yes |
| `sidepods` | Art. 3.6 | `RV-BODY-SIDE` (inlet, undercut, engine cover & coke-bottle fairing) | `body_fairing` | Yes |
| `diffuser` | Art. 3.5.5 | `RV-DIFF` (rear expansion ramp starting forward of rear axle to `X_R = +350 mm`) | `diffuser` | Yes |
| `rear_wing` | Art. 3.11 | `RV-RW` (beamless 2026 3-element active upper rear wing + endplates; **no beam wing**) | `wing` | Yes |

### Legality Functions
- `signedMarginInBox(pt, box)`: Returns signed distance in meters (`>= 0` inside frustum & outside wheel cutout; `< 0` violation depth).
- `signedMarginInUnion(pt, boxes)`: Returns `max_i signedMarginInBox(pt, boxes[i])` across a part's union of Reference Volumes.
- `clampPointToLegalityBoxes(pt, boxes, lockCenterX)`: Projects any candidate control node or surface point onto the nearest legal point across the box union.

---

## 2. Coupled 3D Wind-Tunnel CFD Formulation (`src/cfd/CFDSolver.ts`)

`runCFDSimulation()` executes a two-stage solver designed for `< 20 ms` interactive turnaround while capturing real Formula 1 multi-element aerodynamic coupling:

### Stage 1: Coupled Surface Macro-Panel Aerodynamics
1. **Panel Extraction & Ride-Height Transform:**
   - Consumes `MacroAeroPanel[]` extracted from the deformed 3D car mesh (or falls back to spline patches before GLB load completes).
   - Applies pitch/heave via `applyRideHeightTransform(pt, frontRideHeightM, rearRideHeightM)` around the `3.40 m` wheelbase, plus freestream crosswind yaw `β = yawAngleDeg`.
2. **Upstream-to-Downstream Aero Coupling Pass:**
   - **Front Wing Outwash & Tire Wake Mitigation:** Evaluates spanwise normal tilt (`nx`) and outboard footplate arch on `front_wing` plus inwashing `floor_boards` incidence to compute how effectively turbulent front-tire wake is deflected away from the `floor` leading edge and `sidepods` undercut.
   - **Ground-Effect Venturi Floor & Diffuser Coupling:** Tracks minimum floor throat ride height (`h_min`), longitudinal rake, sidepod undercut mass-flow feeding, and `diffuser` expansion ratio (`A_exit / A_throat`). Models ground-effect suction amplification (`∝ 1 / h_eff`) AND catastrophic **porpoising / choking stall** if `h_min` drops below critical ground clearance (`< ~18 mm`) or if diffuser ramp angle exceeds critical adverse-pressure-gradient separation (`> ~19°`).
   - **Coke-Bottle & Beamless Rear Wing Conditioning:** Evaluates sidepod undercut/coke-bottle inward sweep feeding clean high-energy flow into the `diffuser` roof and lower `rear_wing` cascade, while accounting for upstream stall wake blanking.
   - **2026 Active Aerodynamics (`z_mode` vs `x_mode`):**
     - `z_mode` (Cornering): Full flap incidence on `front_wing` and `rear_wing` (`CL ≈ 3.75`, `CD ≈ 0.99`, `CoP ≈ 45.8% Front`).
     - `x_mode` (Straight-Line): Reduces movable flap effective angle of attack and induced/profile drag on both `front_wing` and `rear_wing` simultaneously so aero balance (`CoP % Front`) shifts by `< 2%` while shedding `~29%` total drag (`CL ≈ 3.17`, `CD ≈ 0.71`, `Top Speed ≈ 370 km/h`).
3. **Force Integration & Vehicle Projections:**
   - Integrates downforce (`N`), drag (`N`), and pitch moment about front/rear axles across both symmetric halves (`× 2`), adding calibrated static chassis + 2026 narrower open-wheel drag/lift baselines.
   - Normalizes coefficients with ISA sea-level air density `ρ = 1.225 kg/m³` and 2026 frontal reference area `A_ref = 1.45 m²`.
   - Computes terminal straight-line speed (`P_PU ≈ 750 kW` 2026 MGU-K + ICE combined power against aero drag + tire rolling resistance) and sustained lateral acceleration at `240 km/h` (`m_car = 768 kg` 2026 minimum weight + driver).

### Stage 2: 3D Space-Marching Semi-Lagrangian Wake Grid (`CFDGridField`)
- Allocates a `34 × 20 × 60` (`40,800`-cell) 3D Cartesian wind-tunnel domain covering `X ∈ [-1.45, +1.45] m`, `Y ∈ [0.0, 1.65] m`, `Z ∈ [-3.35, +3.45] m`.
- Marks solid body & rotating tire voxels (`solid: Uint8Array`), injects `PanelInfluence` impulse kernels (`dvx, dvy, dvz, dcp, dturb`) from every deformed aero macro-panel and wheel wake, and marches longitudinally from `k = 0` (`-Z` inlet) to `k = nz - 1` (`+Z` diffuser wake) using semi-Lagrangian upstream advection + turbulent eddy diffusion + ground/body no-penetration projection.
- `CFDVisualizer.ts` samples this field via trilinear interpolation (`sampleCFDField`) to integrate 3D RK2 streamlines, animate convecting flow particles, and render the interactive 2D `XY` wake contour plane at arbitrary `Z`.

---

## 3. Calibration Targets & Sanity Ranges

When modifying `CFDSolver.ts` or `CarModelLoader.ts`, ensure the unmodified **FIA 2026 Official Concept** at standard wind-tunnel datum (`250 km/h`, `0 mm` FRH/RRH, `0°` Yaw) stays within realistic 2026 F1 engineering windows:

| Metric | `Z-Mode` Target Window | `X-Mode` Target Window |
| :--- | :--- | :--- |
| **Total Downforce (`CL`)** | `3.55 – 3.95` (current: `3.750`) | `2.95 – 3.30` (current: `3.166`) |
| **Total Drag (`CD`)** | `0.94 – 1.06` (current: `0.994`) | `0.66 – 0.76` (current: `0.706`) |
| **Aero Efficiency (`L/D`)** | `3.60 – 3.95` (current: `3.77`) | `4.25 – 4.70` (current: `4.48`) |
| **Aero Balance (`CoP % Front`)** | `44.0% – 47.5%` (current: `45.8%`) | `44.5% – 48.0%` (current: `47.3%`) |
| **2026 Est. Top Speed** | `330 – 342 km/h` | `365 – 378 km/h` (current: `370.3 km/h`) |
| **Baseline Legality (`allLegal`)** | `true` (`0` violating vertices) | `true` (`0` violating vertices) |
