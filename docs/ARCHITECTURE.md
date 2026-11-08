# Technical Architecture — F1 2026 Aero Development & CFD Lab

This document details the runtime data flow, 3D mesh segmentation & welding pipeline, Free-Form Deformation (FFD) math, reactive state architecture, and rendering subsystems.

---

## 1. High-Level System Data Flow

```mermaid
flowchart TD
    Boot["main.ts bootstrap()"] --> Store["CarProjectStore (src/state/CarProjectStore.ts)"]
    Boot --> Scene["SceneManager (src/editor/SceneManager.ts)"]
    Boot --> HUD["HudController (src/ui/HudController.ts)"]

    Scene -->|Async GLTF/GLB Load| Loader["CarModelLoader (src/geometry/CarModelLoader.ts)"]
    Loader -->|Welded Buffers + Seam Pins + Baked Colors| FFD["7x PartFFDController (src/geometry/ffdDeformer.ts)"]

    HUD -->|User Controls / Hotkeys / Presets| Store
    Sculpt["PartSculptor (src/editor/PartSculptor.ts)"] -->|3D Gizmo Drag on grid[u][v]| Store
    Sculpt -->|Live Pointer Drag| Scene

    FFD -->|MacroAeroPanel[] + Legality Sample Pts| Store
    Store -->|runCFDSimulation()| CFD["CFDSolver (src/cfd/CFDSolver.ts)"]
    CFD -->|CFDResult: CL, CD, CoP, Cp Maps, 34x20x60 Field| Store

    Store -->|subscribe()| Scene
    Store -->|subscribe()| HUD
    Scene --> LegViz["LegalityVisualizer (FIA RV-* Wireframes)"]
    Scene --> CFDViz["CFDVisualizer (RK2 Streamlines + 2D Wake Slice)"]
```

---

## 2. 3D Car Loading, Normalization & FIA Segmentation (`src/geometry/CarModelLoader.ts`)

Both 2026 models (`fia_2026_concept` and `ferrari_sf26`) have arbitrary authoring transforms, sub-mesh hierarchies, and triangle soup topologies. `CarModelLoader` normalizes them into a unified, physics-ready assembly (`LoadedCarAssembly`):

1. **Metric & Axle Normalization:**
   - Scales and aligns the raw GLTF scene so the tire contact patches rest on `Y = 0`, the symmetry plane sits on `X = 0`, the front axle aligns with `Z = -1.70 m` (`X_F = 0 mm`), and the rear axle aligns with `Z = +1.70 m` (`X_F = 3400 mm`).
2. **Texture Color Baking (`TextureColorSampler`):**
   - Because deformable parts switch dynamically between **Livery/Carbon**, **Live `Cp` Pressure**, and **Boundary-Layer Stall** vertex-color shaders, `TextureColorSampler` rasterizes each GLTF material's baseColor texture onto an offscreen `<= 256×256` 2D canvas and bakes per-vertex linear RGB (`restColors`) during load.
3. **Triangle-Level Bucket Classification:**
   - Every triangle is classified into one of **12 buckets**:
     - `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr` (isolated into 4 axle-centered `THREE.Group` pivots so tires spin at `ω = V / R` in Wind Tunnel mode).
     - `static_chassis` (survival cell/monocoque, cockpit, driver helmet, halo, mirrors, suspension wishbones/pushrods, rear impact structure).
     - The **7 deformable FIA 2026 bodywork parts** (`front_wing`, `nosecone`, `floor_boards`, `floor`, `sidepods`, `diffuser`, `rear_wing`).
   - **FIA Art. 3.2.2 3-Vertex Reference Volume Gate:** A triangle is assigned to an aero part **only if all 3 of its vertices** lie inside (within a `5 mm` tolerance, `signedMarginInUnion >= -0.005`) that part's official FIA Reference Volume (`RV-*`). Triangles straddling into suspension wishbones or the central survival cell automatically fall back to `static_chassis`, guaranteeing `outOfBoundsMeshVertices === 0` at baseline.
4. **Spatial Vertex Welding & Seam Pinning:**
   - Raw STL/GLTF exports often store disconnected per-triangle vertices, which would crack apart under FFD or produce faceted normals.
   - Each aero part's triangles are spatially welded (`0.5 mm` quantization hash) into a shared indexed `BufferGeometry` with smooth area-weighted vertex normals.
   - Vertices near the static chassis boundary receive a smooth `seamPinFactor` (`0.0` at free aero surfaces → `1.0` on the monocoque seam) so bending sidepods, nosecone, or floor edges blends cleanly into the static chassis without gaps.

---

## 3. Real-Time 3D Free-FormDeformation (`src/geometry/ffdDeformer.ts`)

`PartFFDController` binds a low-dimensional, human-sculptable `[u][v]` control lattice (`AeroPartData.grid` on `+X`, typically `3×4` to `5×5` nodes) to tens of thousands of welded mesh vertices:

- **Top-`K` Smooth Shepard-Gaussian Weights (`K_WEIGHTS = 6`):**
  - At load time, every vertex `(vx, vy, vz)` is mirrored into `+X` (`|vx|, vy, vz`) and linked to its 6 strongest control nodes `(u, v)` using anisotropic Gaussian kernels normalized via Shepard's method (`∑ w_k = 1`).
  - Weights are packed into flat typed arrays (`weightNodeIdx: Uint8Array`, `weightNodeVal: Float32Array`) so runtime deformation performs zero heap allocations and runs in `~2–8 ms` on CPU.
- **Bilateral Symmetry (`X = 0`):**
  - Control nodes represent the `+X` (starboard) half-car. During `deform()`, lateral delta `Δx` is applied with sign `sign(vx)` so port (`-X`) and starboard (`+X`) halves bend symmetrically, while `centerlineFlags` keep vertices on `X = 0` welded along the car's spine.
- **Visual 2026 Active Aero (`X-Mode`):**
  - When `activeAeroMode === 'x_mode'`, `front_wing` and `rear_wing` upper-rear flap zones (`sv > 0.38`) pitch smoothly nose-up/trailing-edge-down around their local flap hinge line, matching FIA 2026 Art. 3.10.9 & 3.11.6 straight-line drag reduction visually and physically.
- **Macro-Panel Extraction (`extractDeformedMacroPanels()`):**
  - At initialization, triangles on the `+X` half-car are grouped into a `(su, sv)` bin grid, storing representative triangles (`RepBinEntry`) weighted by each bin's true surface area.
  - After every deformation, `extractDeformedMacroPanels()` recomputes deformed centroids `(cx, cy, cz)` and unit normals `(nx, ny, nz)` in `< 0.3 ms` to feed `CFDSolver`.

---

## 4. State Store & Undo/Redo (`src/state/CarProjectStore.ts`)

`CarProjectStore` is a lightweight synchronous pub/sub store (`subscribe` / `emit`):

- **Single Source of Truth:** Holds `carModelId`, `parts` (`Record<PartId, AeroPartData>`), `activePartId`, `selectedNode`, `appMode` (`'sculpt' | 'cfd'`), `selectMode`, `gizmoMode`, `softFalloffRadius`, `clampToFiaBox`, `tunnelSettings`, `cfdResult`, and `baselineSnapshot`.
- **Decoupled Mesh Provider:** `SceneManager` registers `store.setMeshCFDDataProvider(() => this.extractActiveMeshCFDData())`. Whenever `store.runCFD()` runs, it pulls live `MacroAeroPanel[]` and sampled legality vertices from the active 3D mesh (or falls back gracefully to `splineSurface.ts` during the initial async GLB load).
- **Undo / Redo & Snapshots:**
  - `PartSculptor` calls `store.pushUndoCheckpoint()` on gizmo `dragging-changed` (`true`), pushing deep-cloned `[u][v]` control grids onto a 40-level `undoStack`.
  - `exportDesignJson()` / `importDesignJson()` serialize and restore `CarDesignSnapshot` JSON files (`carModelId` + all 7 part grids + summary telemetry).

---

## 5. Viewport, Camera & HUD (`src/editor/` & `src/ui/HudController.ts`)

- **`SceneManager.ts`:**
  - Manages the ACES Filmic `WebGLRenderer`, studio/tunnel lighting, rolling-road belt, `OrbitControls`, smooth preset camera flights (`focusPart`, `setCameraPreset`), and frame-rate-independent **`WASD` / `Arrow` + `Q`/`E` + `Shift` camera flight** (`updateKeyboardCameraMovement`).
  - Caches loaded `LoadedCarAssembly` instances in `loadedModels: Map<CarModelId, LoadedCarAssembly>` so switching between the FIA 2026 Concept and Ferrari SF-26 is instantaneous after the first load.
  - Uses `computeGridSignature()` per part so unchanged parts are never needlessly re-deformed when another part is being sculpted.
- **`PartSculptor.ts`:**
  - Attaches Three.js `TransformControls` to an invisible `proxyAnchor` positioned at the selected node, rib centroid, edge centroid, or whole-part centroid.
  - Supports raised-cosine soft falloff (`0.5 * (1 + cos(π * d / R))`) across neighboring lattice nodes and throttles live CFD updates during fast pointer drags (~60–80 ms cadence) with a final exact solve on pointer release.
- **`HudController.ts`:**
  - Pure DOM overlay (`pointer-events: none` on `#hud-root`, `pointer-events: auto` on `.topbar`, `.side-panel`, `.bottom-bar`).
  - Keeps `<input type="range">` elements persistent in memory (updating `.value` in `syncUI()` rather than re-creating `innerHTML`) so dragging wind-tunnel or falloff sliders never drops pointer capture.
