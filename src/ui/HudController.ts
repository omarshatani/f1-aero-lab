import { RakePreset } from '../cfd/CFDVisualizer';
import { CameraPreset, SceneManager } from '../editor/SceneManager';
import { PART_ORDER, signedMarginInUnion, worldToFiaMm } from '../regulations/fia2026';
import { CarProjectStore } from '../state/CarProjectStore';
import {
  ActiveAeroMode,
  PartId,
  SculptSelectMode,
  StreamlineColorMode,
  SurfaceVizMode,
} from '../types/aero';

function fmtDelta(val: number, base: number, digits = 2, invertGood = false): string {
  const diff = val - base;
  if (Math.abs(diff) < Math.pow(10, -digits) * 0.5) {
    return `<span class="delta-neutral">±0</span>`;
  }
  const sign = diff > 0 ? '+' : '';
  const good = invertGood ? diff < 0 : diff > 0;
  const cls = good ? 'delta-pos' : 'delta-neg';
  return `<span class="${cls}">${sign}${diff.toFixed(digits)}</span>`;
}

export class HudController {
  private topbarEl!: HTMLElement;
  private loadingBannerEl!: HTMLElement;
  private leftSculptContainer!: HTMLElement;
  private leftCfdContainer!: HTMLElement;
  private partListEl!: HTMLElement;
  private sculptInfoEl!: HTMLElement;
  private rightTelemetryEl!: HTMLElement;
  private legendEl!: HTMLElement;

  // Persistent inputs so slider dragging is never interrupted
  private falloffInput!: HTMLInputElement;
  private falloffValEl!: HTMLElement;
  private clampCheckbox!: HTMLInputElement;
  private fiaBoxCheckbox!: HTMLInputElement;
  private ghostCheckbox!: HTMLInputElement;

  private windSpeedInput!: HTMLInputElement;
  private windSpeedValEl!: HTMLElement;
  private frontRhInput!: HTMLInputElement;
  private frontRhValEl!: HTMLElement;
  private rearRhInput!: HTMLInputElement;
  private rearRhValEl!: HTMLElement;
  private yawInput!: HTMLInputElement;
  private yawValEl!: HTMLElement;
  private sliceZInput!: HTMLInputElement;
  private sliceZValEl!: HTMLElement;
  private sliceToggleCheckbox!: HTMLInputElement;
  private streamToggleCheckbox!: HTMLInputElement;

  private currentRake: RakePreset = 'full_car';
  private currentStreamColor: StreamlineColorMode = 'velocity';

  constructor(
    private root: HTMLElement,
    private store: CarProjectStore,
    private sceneMgr: SceneManager
  ) {
    this.buildLayout();
    this.bindKeyboardShortcuts();
    this.store.subscribe(() => this.syncUI());
    this.syncUI();
  }

  private buildLayout(): void {
    this.root.innerHTML = `
      <header class="topbar" id="hud-topbar"></header>

      <div class="loading-overlay" id="hud-loading" style="display:none;"></div>

      <aside class="side-panel left-panel">
        <div id="left-sculpt-view" style="display:flex;flex-direction:column;gap:11px;">
          <div>
            <div class="section-title">
              <span>1. 2026 FIA Components (Art. 3)</span>
              <button class="btn btn-sm" id="btn-focus-part" title="Shortcut: F">Focus Cam</button>
            </div>
            <div class="part-list" id="part-list"></div>
          </div>

          <div>
            <div class="section-title">
              <span>2. 3D FFD Sculpt & Bend</span>
              <button class="btn btn-sm" id="btn-reset-part">Reset Part</button>
            </div>
            <div class="control-group">
              <div style="font-size:11px;color:var(--text-muted);">Selection Target</div>
              <div class="seg-grid-2" id="select-mode-btns">
                <button class="btn" data-sel="node">Free Node</button>
                <button class="btn" data-sel="span_rib">Span Rib</button>
                <button class="btn" data-sel="chord_edge">Chord Edge</button>
                <button class="btn" data-sel="whole_part">Whole Part</button>
              </div>

              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">3D Gizmo Action</div>
              <div class="seg-grid-2" id="gizmo-mode-btns">
                <button class="btn" data-gizmo="translate">Bend / Move (G)</button>
                <button class="btn" data-gizmo="rotate">Twist / Pitch (R)</button>
              </div>

              <div class="slider-row">
                <div class="slider-header">
                  <span>Soft Bend Radius</span>
                  <span class="slider-val" id="val-falloff">0.24 m</span>
                </div>
                <input type="range" id="inp-falloff" min="0" max="0.65" step="0.02" value="0.24" />
              </div>

              <div class="coord-readout" id="sculpt-coord-info"></div>
            </div>
          </div>

          <div>
            <div class="section-title"><span>3. FIA 2026 Appendix 1 Box & View</span></div>
            <div class="control-group">
              <label class="check-row">
                <input type="checkbox" id="chk-clamp-fia" checked />
                <span>Clamp Bending to FIA 2026 Box</span>
              </label>
              <label class="check-row">
                <input type="checkbox" id="chk-show-fia" checked />
                <span>Show 3D FIA Reference Volume</span>
              </label>
              <label class="check-row">
                <input type="checkbox" id="chk-ghost-car" />
                <span>Isolate Active Part (Ghost Chassis)</span>
              </label>

              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Surface Overlay</div>
              <div class="seg-grid-3" id="sculpt-viz-btns">
                <button class="btn" data-viz="carbon">Carbon / CAD</button>
                <button class="btn" data-viz="cp">Live Cp</button>
                <button class="btn" data-viz="stall">Stall Risk</button>
              </div>
            </div>
          </div>

          <div>
            <div class="section-title"><span>2026 Aero Philosophy Presets</span></div>
            <div class="seg-grid-3">
              <button class="btn btn-sm" data-preset="baseline">FIA 2026 Base</button>
              <button class="btn btn-sm" data-preset="high_downforce">High-DF</button>
              <button class="btn btn-sm" data-preset="low_drag">Low-Drag</button>
            </div>
          </div>
        </div>

        <div id="left-cfd-view" style="display:none;flex-direction:column;gap:11px;">
          <div>
            <div class="section-title"><span>1. 2026 Wind Tunnel & Active Aero</span></div>
            <div class="control-group">
              <div style="font-size:11px;color:var(--text-muted);">
                FIA 2026 Active Aerodynamics (Shortcut: <b>X</b>)
              </div>
              <div class="seg-grid-2" id="active-aero-btns">
                <button class="btn active" data-aero="z_mode">Z-Mode (Cornering)</button>
                <button class="btn" data-aero="x_mode">X-Mode (Straight)</button>
              </div>

              <div class="slider-row" style="margin-top:2px;">
                <div class="slider-header">
                  <span>Rolling-Road Airspeed</span>
                  <span class="slider-val" id="val-windspeed">250 km/h</span>
                </div>
                <input type="range" id="inp-windspeed" min="100" max="360" step="10" value="250" />
              </div>

              <div class="slider-row">
                <div class="slider-header">
                  <span>Front Ride Height Offset</span>
                  <span class="slider-val" id="val-frh">0 mm</span>
                </div>
                <input type="range" id="inp-frh" min="-18" max="25" step="1" value="0" />
              </div>

              <div class="slider-row">
                <div class="slider-header">
                  <span>Rear Ride Height Offset</span>
                  <span class="slider-val" id="val-rrh">0 mm</span>
                </div>
                <input type="range" id="inp-rrh" min="-15" max="30" step="1" value="0" />
              </div>

              <div class="slider-row">
                <div class="slider-header">
                  <span>Cornering Crosswind Yaw</span>
                  <span class="slider-val" id="val-yaw">0.0°</span>
                </div>
                <input type="range" id="inp-yaw" min="-6" max="6" step="0.5" value="0" />
              </div>

              <button class="btn btn-sm" id="btn-reset-tunnel">Reset Standard Tunnel Datum</button>
            </div>
          </div>

          <div>
            <div class="section-title"><span>2. Smoke Rake & Flow Probes</span></div>
            <div class="control-group">
              <div style="font-size:11px;color:var(--text-muted);">Wind Tunnel Smoke Rake</div>
              <div class="seg-grid-2" id="rake-preset-btns">
                <button class="btn active" data-rake="full_car">Full Car Matrix</button>
                <button class="btn" data-rake="front_outwash">FW & Floor Boards</button>
                <button class="btn" data-rake="underfloor">Step-Plane Floor</button>
                <button class="btn" data-rake="rear_wake">Coke-Bottle & RW</button>
              </div>

              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Flow Field Metric</div>
              <div class="seg-grid-3" id="stream-color-btns">
                <button class="btn active" data-scol="velocity">Velocity</button>
                <button class="btn" data-scol="pressure">Cp Press.</button>
                <button class="btn" data-scol="turbulence">Wake Loss</button>
              </div>

              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Body Surface Shader</div>
              <div class="seg-grid-3" id="cfd-viz-btns">
                <button class="btn" data-viz="cp">Cp Map</button>
                <button class="btn" data-viz="stall">Separation</button>
                <button class="btn" data-viz="carbon">Carbon / Livery</button>
              </div>
            </div>
          </div>

          <div>
            <div class="section-title"><span>3. Cross-Section Wake Slice</span></div>
            <div class="control-group">
              <label class="check-row">
                <input type="checkbox" id="chk-show-streamlines" checked />
                <span>Show 3D RK2 Streamlines & Particles</span>
              </label>
              <label class="check-row">
                <input type="checkbox" id="chk-show-slice" checked />
                <span>Show 2D Wake Contour Plane</span>
              </label>

              <div class="slider-row">
                <div class="slider-header">
                  <span>Slice Plane Longitudinal Z</span>
                  <span class="slider-val" id="val-slicez">+1.25 m</span>
                </div>
                <input type="range" id="inp-slicez" min="-3.15" max="3.15" step="0.05" value="1.25" />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="bottom-bar">
        <div class="legend-bar" id="hud-legend"></div>
        <div class="cam-pill-bar" id="cam-bar">
          <button class="btn btn-sm" data-cam="iso_front">3/4 Front</button>
          <button class="btn btn-sm" data-cam="side_profile">Side Profile</button>
          <button class="btn btn-sm" data-cam="front_throat">Front Throat</button>
          <button class="btn btn-sm" data-cam="underfloor">Underfloor</button>
          <button class="btn btn-sm" data-cam="rear_diffuser">Rear / Diffuser</button>
          <button class="btn btn-sm" data-cam="top_plan">Top Plan</button>
        </div>
        <div class="hint-line">
          <b>WASD / Arrows</b> Move Cam (<b>Q/E</b> Up/Dn · <b>Shift</b> Fast) · <b>1–7</b> Part · <b>G</b> Move · <b>R</b> Twist · <b>Tab</b> CAD / CFD · <b>X</b> Active Aero
        </div>
      </div>

      <aside class="side-panel right-panel" id="hud-right-telemetry"></aside>
    `;

    this.topbarEl = this.root.querySelector('#hud-topbar')!;
    this.loadingBannerEl = this.root.querySelector('#hud-loading')!;
    this.leftSculptContainer = this.root.querySelector('#left-sculpt-view')!;
    this.leftCfdContainer = this.root.querySelector('#left-cfd-view')!;
    this.partListEl = this.root.querySelector('#part-list')!;
    this.sculptInfoEl = this.root.querySelector('#sculpt-coord-info')!;
    this.rightTelemetryEl = this.root.querySelector('#hud-right-telemetry')!;
    this.legendEl = this.root.querySelector('#hud-legend')!;

    this.falloffInput = this.root.querySelector('#inp-falloff')!;
    this.falloffValEl = this.root.querySelector('#val-falloff')!;
    this.clampCheckbox = this.root.querySelector('#chk-clamp-fia')!;
    this.fiaBoxCheckbox = this.root.querySelector('#chk-show-fia')!;
    this.ghostCheckbox = this.root.querySelector('#chk-ghost-car')!;

    this.windSpeedInput = this.root.querySelector('#inp-windspeed')!;
    this.windSpeedValEl = this.root.querySelector('#val-windspeed')!;
    this.frontRhInput = this.root.querySelector('#inp-frh')!;
    this.frontRhValEl = this.root.querySelector('#val-frh')!;
    this.rearRhInput = this.root.querySelector('#inp-rrh')!;
    this.rearRhValEl = this.root.querySelector('#val-rrh')!;
    this.yawInput = this.root.querySelector('#inp-yaw')!;
    this.yawValEl = this.root.querySelector('#val-yaw')!;
    this.sliceZInput = this.root.querySelector('#inp-slicez')!;
    this.sliceZValEl = this.root.querySelector('#val-slicez')!;
    this.sliceToggleCheckbox = this.root.querySelector('#chk-show-slice')!;
    this.streamToggleCheckbox = this.root.querySelector('#chk-show-streamlines')!;

    this.bindLeftPanelEvents();
    this.bindCameraBarEvents();
  }

  private bindLeftPanelEvents(): void {
    this.root.querySelector('#btn-focus-part')!.addEventListener('click', () => {
      this.sceneMgr.focusPart(this.store.activePartId);
    });

    this.root.querySelector('#btn-reset-part')!.addEventListener('click', () => {
      this.store.resetActivePartToBaseline();
    });

    this.root.querySelectorAll<HTMLButtonElement>('#select-mode-btns button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.store.selectMode = btn.dataset.sel as SculptSelectMode;
        this.store.emit();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#gizmo-mode-btns button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.store.gizmoMode = btn.dataset.gizmo as 'translate' | 'rotate';
        this.store.emit();
      });
    });

    this.falloffInput.addEventListener('input', () => {
      this.store.softFalloffRadius = parseFloat(this.falloffInput.value);
      this.falloffValEl.textContent = `${this.store.softFalloffRadius.toFixed(2)} m`;
      this.sceneMgr.sculptor.updateCageAndHandles();
    });

    this.clampCheckbox.addEventListener('change', () => {
      this.store.setClampToFiaBox(this.clampCheckbox.checked);
    });

    this.fiaBoxCheckbox.addEventListener('change', () => {
      this.store.showFiaBox = this.fiaBoxCheckbox.checked;
      this.store.emit();
    });

    this.ghostCheckbox.addEventListener('change', () => {
      this.store.ghostOtherParts = this.ghostCheckbox.checked;
      this.store.emit();
    });

    const bindVizButtons = (selector: string) => {
      this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
        btn.addEventListener('click', () => {
          this.store.surfaceVizMode = btn.dataset.viz as SurfaceVizMode;
          this.store.emit();
        });
      });
    };
    bindVizButtons('#sculpt-viz-btns button');
    bindVizButtons('#cfd-viz-btns button');

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.preset as 'baseline' | 'high_downforce' | 'low_drag';
        this.store.applyConceptPreset(p);
      });
    });

    // 2026 Active Aerodynamics Z-Mode / X-Mode buttons
    this.root.querySelectorAll<HTMLButtonElement>('#active-aero-btns button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.aero as ActiveAeroMode;
        this.store.updateTunnelSettings({ activeAeroMode: mode });
      });
    });

    // Wind tunnel sliders
    this.windSpeedInput.addEventListener('input', () => {
      this.store.updateTunnelSettings({ windSpeedKmh: parseFloat(this.windSpeedInput.value) });
    });
    this.frontRhInput.addEventListener('input', () => {
      this.store.updateTunnelSettings({ frontRideHeightMm: parseFloat(this.frontRhInput.value) });
    });
    this.rearRhInput.addEventListener('input', () => {
      this.store.updateTunnelSettings({ rearRideHeightMm: parseFloat(this.rearRhInput.value) });
    });
    this.yawInput.addEventListener('input', () => {
      this.store.updateTunnelSettings({ yawAngleDeg: parseFloat(this.yawInput.value) });
    });

    this.root.querySelector('#btn-reset-tunnel')!.addEventListener('click', () => {
      this.store.updateTunnelSettings({
        windSpeedKmh: 250,
        frontRideHeightMm: 0,
        rearRideHeightMm: 0,
        yawAngleDeg: 0,
        activeAeroMode: 'z_mode',
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#rake-preset-btns button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentRake = btn.dataset.rake as RakePreset;
        this.sceneMgr.cfdViz.setRakePreset(this.currentRake);
        this.syncUI();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('#stream-color-btns button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentStreamColor = btn.dataset.scol as StreamlineColorMode;
        this.sceneMgr.cfdViz.setColorMode(this.currentStreamColor);
        this.syncUI();
      });
    });

    this.streamToggleCheckbox.addEventListener('change', () => {
      this.sceneMgr.cfdViz.setStreamlinesVisible(this.streamToggleCheckbox.checked);
    });

    this.sliceToggleCheckbox.addEventListener('change', () => {
      this.sceneMgr.cfdViz.setSliceVisible(this.sliceToggleCheckbox.checked);
    });

    this.sliceZInput.addEventListener('input', () => {
      const z = parseFloat(this.sliceZInput.value);
      this.sceneMgr.cfdViz.setSliceZ(z);
      this.sliceZValEl.textContent = `${z >= 0 ? '+' : ''}${z.toFixed(2)} m`;
    });
  }

  private bindCameraBarEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('#cam-bar button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sceneMgr.setCameraPreset(btn.dataset.cam as CameraPreset);
      });
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable) ||
        (e.target instanceof HTMLInputElement &&
          e.target.type !== 'range' &&
          e.target.type !== 'checkbox' &&
          e.target.type !== 'button')
      ) {
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        this.store.setAppMode(this.store.appMode === 'sculpt' ? 'cfd' : 'sculpt');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo();
        else this.store.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.store.redo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g' && this.store.appMode === 'sculpt') {
        this.store.gizmoMode = 'translate';
        this.store.emit();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r' && this.store.appMode === 'sculpt') {
        this.store.gizmoMode = 'rotate';
        this.store.emit();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'x') {
        const nextMode: ActiveAeroMode =
          this.store.tunnelSettings.activeAeroMode === 'z_mode' ? 'x_mode' : 'z_mode';
        this.store.updateTunnelSettings({ activeAeroMode: nextMode });
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
        this.sceneMgr.focusPart(this.store.activePartId);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key, 10) - 1;
        if (PART_ORDER[idx]) {
          this.store.setActivePart(PART_ORDER[idx]);
        }
      }
    });
  }

  public syncUI(): void {
    const isSculpt = this.store.appMode === 'sculpt';
    const res = this.store.cfdResult;

    // 0. Loading Banner
    if (this.store.modelLoading.active) {
      this.loadingBannerEl.style.display = 'flex';
      this.loadingBannerEl.innerHTML = `
        <div class="loading-card">
          <div class="loading-title">${this.store.modelLoading.label}</div>
          <div class="loading-bar-bg">
            <div class="loading-bar-fill" style="width:${this.store.modelLoading.pct}%"></div>
          </div>
        </div>
      `;
    } else {
      this.loadingBannerEl.style.display = 'none';
    }

    // 1. Topbar
    this.topbarEl.innerHTML = `
      <div class="brand">
        <span class="brand-badge">FIA 2026</span>
        <div>
          <div class="brand-title">F1 2026 Aero Development & CFD Lab</div>
          <div class="brand-sub">${
            res.allLegal
              ? 'FIA 2026 Issue 8 Scrutineering: COMPLIANT'
              : 'FIA 2026 Scrutineering: OUT OF REFERENCE VOLUME'
          }</div>
        </div>
      </div>

      <div class="mode-switch">
        <button class="mode-btn ${isSculpt ? 'active-sculpt' : ''}" id="top-mode-sculpt">
          CAD Sculpt Studio
        </button>
        <button class="mode-btn ${!isSculpt ? 'active-cfd' : ''}" id="top-mode-cfd">
          Wind Tunnel CFD
        </button>
      </div>

      <div class="topbar-actions">
        <button class="btn btn-sm" id="top-undo" ${this.store.canUndo() ? '' : 'disabled'} title="Ctrl+Z">Undo</button>
        <button class="btn btn-sm" id="top-redo" ${this.store.canRedo() ? '' : 'disabled'} title="Ctrl+Y">Redo</button>
        <button class="btn btn-sm" id="top-export">Save</button>
        <button class="btn btn-sm" id="top-import">Load</button>
      </div>
    `;

    this.topbarEl.querySelector('#top-mode-sculpt')!.addEventListener('click', () => {
      this.store.setAppMode('sculpt');
    });
    this.topbarEl.querySelector('#top-mode-cfd')!.addEventListener('click', () => {
      this.store.setAppMode('cfd');
    });
    this.topbarEl.querySelector('#top-undo')!.addEventListener('click', () => this.store.undo());
    this.topbarEl.querySelector('#top-redo')!.addEventListener('click', () => this.store.redo());
    this.topbarEl
      .querySelector('#top-export')!
      .addEventListener('click', () => this.exportFile());
    this.topbarEl
      .querySelector('#top-import')!
      .addEventListener('click', () => this.importFile());

    // 2. Toggle Left View
    this.leftSculptContainer.style.display = isSculpt ? 'flex' : 'none';
    this.leftCfdContainer.style.display = !isSculpt ? 'flex' : 'none';

    if (isSculpt) {
      this.renderPartCards();
      this.syncSculptControls();
    } else {
      this.syncCfdControls();
    }

    // 3. Legend Bar
    this.renderLegend();

    // 4. Right Telemetry & Engineering Diagnostics
    this.renderRightTelemetry();
  }

  private renderPartCards(): void {
    const res = this.store.cfdResult;
    this.partListEl.innerHTML = PART_ORDER.map((id, idx) => {
      const p = this.store.parts[id];
      const m = res.partMetrics[id];
      const sel = id === this.store.activePartId ? 'selected' : '';
      const badge = m.isLegal
        ? `<span class="badge badge-legal">FIA OK</span>`
        : `<span class="badge badge-illegal">ILLEGAL</span>`;

      return `
        <div class="part-card ${sel}" data-part="${id}">
          <div class="part-row-top">
            <span class="part-name">
              <span class="part-dot" style="background:${p.accentHex}"></span>
              ${idx + 1}. ${p.shortName}
            </span>
            ${badge}
          </div>
          <div class="part-row-sub">
            <span>${p.articleRef}</span>
            <span>DF ${m.downforceN}N · D ${m.dragN}N</span>
          </div>
        </div>
      `;
    }).join('');

    this.partListEl.querySelectorAll<HTMLElement>('.part-card').forEach((card) => {
      card.addEventListener('click', () => {
        const pid = card.dataset.part as PartId;
        this.store.setActivePart(pid);
      });
      card.addEventListener('dblclick', () => {
        const pid = card.dataset.part as PartId;
        this.sceneMgr.focusPart(pid);
      });
    });
  }

  private syncSculptControls(): void {
    this.root.querySelectorAll<HTMLButtonElement>('#select-mode-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sel === this.store.selectMode);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#gizmo-mode-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.gizmo === this.store.gizmoMode);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#sculpt-viz-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viz === this.store.surfaceVizMode);
    });

    this.falloffInput.value = String(this.store.softFalloffRadius);
    this.falloffValEl.textContent = `${this.store.softFalloffRadius.toFixed(2)} m`;
    this.clampCheckbox.checked = this.store.clampToFiaBox;
    this.fiaBoxCheckbox.checked = this.store.showFiaBox;
    this.ghostCheckbox.checked = this.store.ghostOtherParts;

    const part = this.store.getActivePart();
    const { u, v } = this.store.selectedNode;
    const pt = part.grid[u][v];
    const fia = worldToFiaMm(pt);
    const clearMm = Math.round(signedMarginInUnion(pt, part.legalityBoxes) * 1000);

    this.sculptInfoEl.innerHTML = `
      <span>FIA [${u},${v}]: X<sub>F</sub>${fia.xF.toFixed(0)} Y${fia.yFia.toFixed(
      0
    )} Z${fia.zFia.toFixed(0)}</span>
      <span style="color:${clearMm >= 0 ? '#34d399' : '#f87171'}">RV: ${
      clearMm >= 0 ? '+' : ''
    }${clearMm} mm</span>
    `;
  }

  private syncCfdControls(): void {
    const ts = this.store.tunnelSettings;
    this.windSpeedInput.value = String(ts.windSpeedKmh);
    this.windSpeedValEl.textContent = `${ts.windSpeedKmh} km/h`;

    this.frontRhInput.value = String(ts.frontRideHeightMm);
    this.frontRhValEl.textContent = `${ts.frontRideHeightMm >= 0 ? '+' : ''}${
      ts.frontRideHeightMm
    } mm`;

    this.rearRhInput.value = String(ts.rearRideHeightMm);
    this.rearRhValEl.textContent = `${ts.rearRideHeightMm >= 0 ? '+' : ''}${
      ts.rearRideHeightMm
    } mm`;

    this.yawInput.value = String(ts.yawAngleDeg);
    this.yawValEl.textContent = `${ts.yawAngleDeg.toFixed(1)}°`;

    const z = this.sceneMgr.cfdViz.getSliceZ();
    this.sliceZInput.value = String(z);
    this.sliceZValEl.textContent = `${z >= 0 ? '+' : ''}${z.toFixed(2)} m`;

    this.root.querySelectorAll<HTMLButtonElement>('#active-aero-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.aero === ts.activeAeroMode);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#rake-preset-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.rake === this.currentRake);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#stream-color-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scol === this.currentStreamColor);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#cfd-viz-btns button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viz === this.store.surfaceVizMode);
    });
  }

  private renderLegend(): void {
    if (this.store.appMode === 'sculpt' && this.store.surfaceVizMode === 'carbon') {
      const part = this.store.getActivePart();
      this.legendEl.style.display = 'flex';
      this.legendEl.innerHTML = `
        <span style="color:var(--accent-cyan);font-weight:600;">${part.name}:</span>
        <span style="color:var(--text-muted);font-family:var(--font-sans);">${part.description}</span>
      `;
      return;
    }

    this.legendEl.style.display = 'flex';
    if (this.store.surfaceVizMode === 'stall') {
      this.legendEl.innerHTML = `
        <span>Boundary Layer:</span>
        <span style="color:#2dd4bf;">Attached Clean Flow</span>
        <span>→</span>
        <span style="color:#f43f5e;">Separated / Stalled Vortex</span>
      `;
    } else {
      this.legendEl.innerHTML = `
        <span>Cp Suction -1.8</span>
        <div class="cp-gradient"></div>
        <span>+1.0 Stagnation</span>
      `;
    }
  }

  private renderRightTelemetry(): void {
    const res = this.store.cfdResult;
    const base = this.store.baselineSnapshot.summary!;
    const modeTag =
      res.settings.activeAeroMode === 'x_mode'
        ? '<span class="badge" style="background:rgba(56,189,248,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);">X-MODE</span>'
        : '<span class="badge badge-legal">Z-MODE</span>';

    const markerPct = Math.max(2, Math.min(98, ((res.copFrontPct - 30) / 32) * 100));
    const dfKgf = Math.round(res.totalDownforceN / 9.81);

    const rowsHtml = PART_ORDER.map((id) => {
      const m = res.partMetrics[id];
      const stallColor =
        m.stalledAreaPct > 15 ? '#f87171' : m.stalledAreaPct > 4 ? '#fbbf24' : '#34d399';
      return `
        <tr class="clickable-row" data-jump-part="${id}">
          <td style="font-family:var(--font-sans);font-weight:500;">${m.name}</td>
          <td>${m.cl.toFixed(2)}</td>
          <td>${m.cd.toFixed(2)}</td>
          <td style="color:${stallColor}">${m.stalledAreaPct.toFixed(0)}%</td>
        </tr>
      `;
    }).join('');

    const diagHtml = res.diagnostics
      .map((d) => {
        const jumpBtn = d.partId
          ? `<button class="btn btn-sm" data-diag-part="${d.partId}">Edit Part</button>`
          : '';
        return `
          <div class="diag-card ${d.severity}">
            <div class="diag-title">
              <span>${d.title}</span>
              ${jumpBtn}
            </div>
            <div class="diag-detail">${d.detail}</div>
            <div class="diag-tip">↳ ${d.suggestion}</div>
          </div>
        `;
      })
      .join('');

    this.rightTelemetryEl.innerHTML = `
      <div>
        <div class="section-title">
          <span>CFD Telemetry (${res.settings.windSpeedKmh} kph) ${modeTag}</span>
          <button class="btn btn-sm" id="btn-pin-baseline" title="Save current numbers as delta reference">
            Pin Baseline
          </button>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">
              <span>DOWNFORCE (CL)</span>
              ${fmtDelta(res.cl, base.cl, 3, false)}
            </div>
            <div class="kpi-value">${res.cl.toFixed(3)}</div>
            <div class="kpi-sub">
              <span>${res.totalDownforceN.toLocaleString()} N (${dfKgf} kgf)</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">
              <span>TOTAL DRAG (CD)</span>
              ${fmtDelta(res.cd, base.cd, 3, true)}
            </div>
            <div class="kpi-value">${res.cd.toFixed(3)}</div>
            <div class="kpi-sub">
              <span>${res.totalDragN.toLocaleString()} N</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">
              <span>EFFICIENCY (L/D)</span>
              ${fmtDelta(res.ldRatio, base.ldRatio, 2, false)}
            </div>
            <div class="kpi-value" style="color:var(--accent-cyan);">${res.ldRatio.toFixed(2)}</div>
            <div class="kpi-sub">
              <span>Ref: ${base.ldRatio.toFixed(2)}</span>
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">
              <span>2026 PROJECTION</span>
            </div>
            <div class="kpi-value" style="font-size:14.5px;">${res.topSpeedEstKmh.toFixed(0)} km/h</div>
            <div class="kpi-sub">
              <span>240kph Grip: ${res.highSpeedCornerG.toFixed(2)} G</span>
            </div>
          </div>
        </div>
      </div>

      <div class="balance-box">
        <div class="slider-header">
          <span style="font-weight:600;font-size:11.5px;">Aero Balance (CoP Front)</span>
          <span class="slider-val">${res.copFrontPct.toFixed(1)}% Front (Target 44–47.5%)</span>
        </div>
        <div class="balance-track">
          <div class="balance-sweetspot" title="Ideal Neutral Window (44.0% - 47.5%)"></div>
          <div class="balance-marker" style="left:${markerPct}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);">
          <span>← Rearward (Understeer)</span>
          <span>Forward (Oversteer) →</span>
        </div>
      </div>

      <div>
        <div class="section-title"><span>2026 Component Breakdown (Click to Edit)</span></div>
        <table class="aero-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>CL</th>
              <th>CD</th>
              <th>Stall</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div>
        <div class="section-title">
          <span>CFD Findings & Improvement Advisor</span>
          <span style="color:var(--accent-cyan);">${res.diagnostics.length}</span>
        </div>
        <div class="diag-list">
          ${diagHtml}
        </div>
      </div>
    `;

    this.rightTelemetryEl.querySelector('#btn-pin-baseline')!.addEventListener('click', () => {
      this.store.setCurrentAsBaseline();
    });

    this.rightTelemetryEl.querySelectorAll<HTMLElement>('[data-jump-part]').forEach((row) => {
      row.addEventListener('click', () => {
        const pid = row.dataset.jumpPart as PartId;
        this.store.setActivePart(pid);
        if (this.store.appMode !== 'sculpt') {
          this.store.setAppMode('sculpt');
        }
        this.sceneMgr.focusPart(pid);
      });
    });

    this.rightTelemetryEl.querySelectorAll<HTMLButtonElement>('[data-diag-part]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.diagPart as PartId;
        this.store.setActivePart(pid);
        this.store.setAppMode('sculpt');
        this.sceneMgr.focusPart(pid);
      });
    });
  }

  private exportFile(): void {
    const json = this.store.exportDesignJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `f1-2026-aero-spec-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      this.store.importDesignJson(text);
    });
    input.click();
  }
}
