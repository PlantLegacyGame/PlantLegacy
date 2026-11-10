import type { PlantRendererConfig } from '../config/plantRendererConfig.js';

export interface DevPanelAPI {
  panel: HTMLElement;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isVisible: () => boolean;
  updateTileInfo: (
    tileX: number,
    tileZ: number,
    resources: {
      light: number;
      moisture: number;
      minerals: number;
      storedWater?: number;
      storedMinerals?: number;
      rootTileCount?: number;
    },
  ) => void;
}

export interface DevPanelConfig {
  environmentRenderer: {
    setTimeOfDay: (t: number) => void;
    setWeatherState: (state: string) => void;
    getTimeOfDay: () => number;
    getWeatherState: () => string;
    getSunIntensity: () => number;
  };
  resourceWorld: {
    setTileResources: (
      x: number,
      z: number,
      resources: { light?: number; moisture?: number; minerals?: number },
    ) => void;
    getTileResources: (
      x: number,
      z: number,
    ) => { light: number; moisture: number; minerals: number } | null;
    getTileSize: () => number;
    getGridWidth: () => number;
    getGridHeight: () => number;
  };
  plantRenderer: {
    setLODDistances: (l0: number, l1: number, l2: number) => void;
    setQuality: (quality: 'low' | 'medium' | 'high' | 'ultra') => void;
    setRaymarchSteps: (l0: number, l1: number, l2: number) => void;
    setWindStrength: (strength: number) => void;
    setWindSpeed: (speed: number) => void;
    setHealthTint: (strength: number) => void;
    getConfig: () => PlantRendererConfig;
  };
  plantWorld: {
    setGrowthSpeed: (root: number, canopy: number) => void;
    setPhotosynthesisRate: (rate: number) => void;
    setEnergyUpkeep: (perBiomass: number) => void;
    setMaxEnergy: (max: number) => void;
    regeneratePlant: () => void;
  };
  camera: {
    setDistance: (dist: number) => void;
    setSmoothing: (s: number) => void;
    setBounds: (min: number, max: number) => void;
  };
  ui: {
    setTextScale: (scale: number) => void;
  };
  plantState: {
    getPlantId: () => string | null;
    getPlantNodes: () => Map<string, unknown> | null;
  };
  sendToServer: (type: number, payload: unknown) => void;
}

type TabId = 'time-weather' | 'resources' | 'plant' | 'render' | 'camera' | 'simulation' | 'debug';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  build: (container: HTMLElement, config: DevPanelConfig) => void;
}

export function createDevPanel(config: DevPanelConfig): DevPanelAPI {
  const state = {
    visible: false,
    activeTab: 'time-weather' as TabId,
    searchQuery: '',
    currentTile: null as { x: number; z: number } | null,
  };

  // Create panel element
  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    z-index: 10000;
    background: linear-gradient(180deg, var(--bark-900) 0%, var(--bark-800) 100%);
    border: 2px solid var(--leaf-600);
    border-radius: 12px;
    color: var(--bone-100);
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 12px;
    width: 420px;
    max-width: 90vw;
    max-height: calc(100vh - 80px);
    display: none;
    box-shadow: 0 16px 48px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05);
    font-weight: 400;
    resize: both;
    min-width: 380px;
    min-height: 300px;
    pointer-events: auto;
  `;

  // Build HTML structure
  panel.innerHTML = `
    <div class="dp-header" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bark-800);
      border-bottom: 1px solid var(--bark-600);
      border-radius: 10px 10px 0 0;
      cursor: grab;
    ">
      <span style="font-weight:600;color:var(--leaf-300);font-size:11px;text-transform:uppercase;letter-spacing:0.5px">⚙️ Dev Panel</span>
      <div style="display:flex;gap:4px">
        <button class="dp-min-btn" title="Minimize" style="width:24px;height:24px;border-radius:4px;background:var(--bark-700);border:1px solid var(--bark-500);color:var(--bark-300);cursor:pointer;display:flex;align-items:center;justify-content:center">−</button>
        <button class="dp-close-btn" title="Close (Backtick)" style="width:24px;height:24px;border-radius:4px;background:var(--bark-700);border:1px solid var(--bark-500);color:var(--bark-300);cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>
      </div>
    </div>
    <div class="dp-tabs" style="
      display:flex;
      flex-wrap:wrap;
      gap:4px;
      padding:6px 8px;
      background:var(--bark-800);
      border-bottom:1px solid var(--bark-600);
      user-select:none;
    "></div>
    <input class="dp-search" type="text" placeholder="Search entries..." style="
      width:100%;
      padding:10px 14px;
      background:var(--bark-900);
      border:none;
      border-bottom:1px solid var(--bark-600);
      color:var(--bone-100);
      font-family:inherit;
      font-size:11px;
      box-sizing:border-box;
      display:none;
    ">
    <div class="dp-content" style="
      padding:12px 16px;
      max-height:calc(100vh - 200px);
      overflow-y:auto;
      scrollbar-width:thin;
      scrollbar-color:var(--leaf-500) var(--bark-800);
    "></div>
  `;

  // Get element references
  const tabsEl = panel.querySelector('.dp-tabs') as HTMLElement;
  const contentEl = panel.querySelector('.dp-content') as HTMLElement;
  const searchEl = panel.querySelector('.dp-search') as HTMLInputElement;
  const headerEl = panel.querySelector('.dp-header') as HTMLElement;
  const minimizeBtn = panel.querySelector('.dp-min-btn') as HTMLButtonElement;
  const closeBtn = panel.querySelector('.dp-close-btn') as HTMLButtonElement;

  // State
  let visible = false;
  let activeTab: TabId = 'time-weather';
  let searchQuery = '';
  let isMinimized = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let isDragging = false;

  // ===== TAB DEFINITIONS =====
  const tabs: Tab[] = [
    {
      id: 'time-weather',
      label: 'Time & Weather',
      icon: '🌤️',
      build: (container, cfg) => {
        const env = cfg.environmentRenderer;
        addSection(container, 'Time of Day', [
          createNumberInput(
            'Time',
            () => env.getTimeOfDay(),
            (v) => {
              env.setTimeOfDay(v);
            },
            0,
            0.999,
            0.001,
            '0–1',
          ),
          createButtonGroup('Presets', [
            { label: 'Dawn', action: () => env.setTimeOfDay(0.25) },
            { label: 'Noon', action: () => env.setTimeOfDay(0.5) },
            { label: 'Dusk', action: () => env.setTimeOfDay(0.75) },
            { label: 'Midnight', action: () => env.setTimeOfDay(0) },
          ]),
          createNumberInput(
            'Time Speed',
            () => 1,
            (_v) => {},
            0,
            100,
            1,
            '×',
          ),
          createToggle(
            'Freeze Time',
            () => false,
            (_v) => {},
          ),
        ]);
        addSection(container, 'Weather', [
          createSelect(
            'State',
            () => env.getWeatherState(),
            (v) => env.setWeatherState(v),
            [
              { value: 'clear', label: '☀️ Clear' },
              { value: 'rain', label: '🌧️ Rain' },
              { value: 'thunderstorm_telegraph', label: '⛈️ Storm Telegraph' },
              { value: 'thunderstorm_active', label: '⚡ Storm Active' },
              { value: 'thunderstorm_aftermath', label: '🌫️ Storm Aftermath' },
            ],
          ),
          createNumberInput(
            'Sun Intensity',
            () => env.getSunIntensity(),
            (_v) => {},
            0,
            2,
            0.01,
            '×',
          ),
        ]);
      },
    },
    {
      id: 'resources',
      label: 'Resources',
      icon: '🌱',
      build: (container, cfg) => {
        const rw = cfg.resourceWorld;
        const send = cfg.sendToServer;
        addSection(container, 'Tile Inspector', [
          createReadonly('Current Tile', () => {
            if (!state.currentTile) return 'No plant selected';
            const res = rw.getTileResources(state.currentTile.x, state.currentTile.z);
            if (!res) return 'Out of bounds';
            return `Light: ${res.light.toFixed(1)} · Moisture: ${res.moisture.toFixed(1)} · Minerals: ${res.minerals.toFixed(1)}`;
          }),
        ]);
        addSection(container, 'Global Config', [
          createNumberInput(
            'Photosynthesis Rate',
            () => 10000,
            (v) => send(99, { type: 'dev_set_resources', photosynthesis_rate: v }),
            0,
            50000,
            100,
          ),
          createSelect(
            'Light Curve',
            () => 'default',
            (v) => send(99, { type: 'dev_set_resources', light_curve: v }),
            [
              { value: 'default', label: 'Default' },
              { value: 'high', label: 'High Efficiency' },
              { value: 'low', label: 'Low Efficiency' },
            ],
          ),
          createSelect(
            'Moisture Curve',
            () => 'default',
            (v) => send(99, { type: 'dev_set_resources', moisture_curve: v }),
            [
              { value: 'default', label: 'Default' },
              { value: 'high', label: 'High Efficiency' },
              { value: 'low', label: 'Low Efficiency' },
            ],
          ),
          createSelect(
            'Mineral Curve',
            () => 'default',
            (v) => send(99, { type: 'dev_set_resources', mineral_curve: v }),
            [
              { value: 'default', label: 'Default' },
              { value: 'high', label: 'High Efficiency' },
              { value: 'low', label: 'Low Efficiency' },
            ],
          ),
          createNumberInput(
            'Diffusion Rate',
            () => 0.01,
            (v) => send(99, { type: 'dev_set_resources', diffusion_rate: v }),
            0,
            0.1,
            0.001,
          ),
          createNumberInput(
            'Max Absorption/Tick',
            () => 1.0,
            (v) => send(99, { type: 'dev_set_resources', max_absorption_per_tick: v }),
            0,
            10,
            0.1,
          ),
          createNumberInput(
            'Rain Gain/sec',
            () => 0.5,
            (v) => send(99, { type: 'dev_set_resources', rain_gain_per_s: v }),
            0,
            5,
            0.1,
          ),
          createNumberInput(
            'Evaporation/sec',
            () => 0.1,
            (v) => send(99, { type: 'dev_set_resources', evaporation_per_s: v }),
            0,
            1,
            0.01,
          ),
          createNumberInput(
            'Canopy Shade',
            () => 0.1,
            (v) => send(99, { type: 'dev_set_resources', canopy_shade_reduction: v }),
            0,
            1,
            0.01,
          ),
          createButtonGroup('Apply/Reset', [
            {
              label: 'Apply to Server',
              action: () => {
                send(99, {
                  type: 'dev_set_resources',
                  payload: {
                    photosynthesis_rate: (
                      document.getElementById('dev-photosynthesis-rate') as HTMLInputElement
                    )?.value,
                    light_curve: (document.getElementById('dev-light-curve') as HTMLSelectElement)
                      ?.value,
                    moisture_curve: (
                      document.getElementById('dev-moisture-curve') as HTMLSelectElement
                    )?.value,
                    mineral_curve: (
                      document.getElementById('dev-mineral-curve') as HTMLSelectElement
                    )?.value,
                    diffusion_rate: (
                      document.getElementById('dev-diffusion-rate') as HTMLInputElement
                    )?.value,
                    max_absorption_per_tick: (
                      document.getElementById('dev-max-absorption') as HTMLInputElement
                    )?.value,
                    rain_gain_per_s: (document.getElementById('dev-rain-gain') as HTMLInputElement)
                      ?.value,
                    evaporation_per_s: (
                      document.getElementById('dev-evaporation') as HTMLInputElement
                    )?.value,
                    canopy_shade_reduction: (
                      document.getElementById('dev-canopy-shade') as HTMLInputElement
                    )?.value,
                  },
                });
              },
              primary: true,
            },
            { label: 'Reset Defaults', action: () => send(99, { type: 'dev_reset_resources' }) },
          ]),
        ]);
        addSection(container, 'Tile Actions (at plant)', [
          createButtonGroup('Actions', [
            {
              label: '💧 Fill Moisture',
              action: () => {
                if (state.currentTile) {
                  rw.setTileResources(state.currentTile.x, state.currentTile.z, { moisture: 500 });
                  send(99, {
                    type: 'dev_set_tile',
                    x: state.currentTile.x,
                    z: state.currentTile.z,
                    moisture: 500,
                  });
                }
              },
            },
            {
              label: '⛏️ Fill Minerals',
              action: () => {
                if (state.currentTile) {
                  rw.setTileResources(state.currentTile.x, state.currentTile.z, { minerals: 500 });
                  send(99, {
                    type: 'dev_set_tile',
                    x: state.currentTile.x,
                    z: state.currentTile.z,
                    minerals: 500,
                  });
                }
              },
            },
            {
              label: '✨ Fill All',
              action: () => {
                if (state.currentTile) {
                  rw.setTileResources(state.currentTile.x, state.currentTile.z, {
                    light: 500,
                    moisture: 500,
                    minerals: 500,
                  });
                  send(99, {
                    type: 'dev_set_tile',
                    x: state.currentTile.x,
                    z: state.currentTile.z,
                    light: 500,
                    moisture: 500,
                    minerals: 500,
                  });
                }
              },
            },
            {
              label: '💀 Drain All',
              action: () => {
                if (state.currentTile) {
                  rw.setTileResources(state.currentTile.x, state.currentTile.z, {
                    light: 0,
                    moisture: 0,
                    minerals: 0,
                  });
                  send(99, {
                    type: 'dev_set_tile',
                    x: state.currentTile.x,
                    z: state.currentTile.z,
                    light: 0,
                    moisture: 0,
                    minerals: 0,
                  });
                }
              },
            },
          ]),
        ]);
      },
    },
    {
      id: 'plant',
      label: 'Plant',
      icon: '🌿',
      build: (container, cfg) => {
        const pw = cfg.plantWorld;
        const send = cfg.sendToServer;
        addSection(container, 'Growth', [
          createNumberInput(
            'Root Speed',
            () => 0.85,
            (v) => pw.setGrowthSpeed(v, 0.95),
            0.1,
            10,
            0.01,
            '×',
          ),
          createNumberInput(
            'Canopy Speed',
            () => 0.95,
            (v) => pw.setGrowthSpeed(0.85, v),
            0.1,
            10,
            0.01,
            '×',
          ),
          createNumberInput(
            'Cooldown',
            () => 0.5,
            (v) => send(99, { type: 'dev_set_growth', growth_cooldown: v }),
            0,
            10,
            0.1,
            's',
          ),
          createNumberInput(
            'Root Attack ×',
            () => 2.0,
            (v) => send(99, { type: 'dev_set_growth', root_attack_damage_multiplier: v }),
            0.5,
            10,
            0.1,
            '×',
          ),
        ]);
        addSection(container, 'Energy', [
          createNumberInput(
            'Photosynthesis E/s',
            () => 10.0,
            (v) => pw.setPhotosynthesisRate(v),
            0.1,
            100,
            0.1,
          ),
          createNumberInput(
            'Upkeep per Biomass',
            () => 0.01,
            (v) => pw.setEnergyUpkeep(v),
            0.001,
            0.1,
            0.001,
          ),
          createNumberInput(
            'Max Energy',
            () => 10000,
            (v) => pw.setMaxEnergy(v),
            100,
            1000000,
            100,
          ),
        ]);
        addSection(container, 'Germination', [
          createNumberInput(
            'Min Moisture',
            () => 30,
            (v) => send(99, { type: 'dev_set_growth', germination_min_moisture: v }),
            0,
            100,
            1,
          ),
          createNumberInput(
            'Min Light',
            () => 10,
            (v) => send(99, { type: 'dev_set_growth', germination_min_light: v }),
            0,
            100,
            1,
          ),
        ]);
        addSection(container, 'Actions', [
          createButtonGroup('Instant', [
            { label: '🌱 Regenerate', action: () => pw.regeneratePlant(), primary: true },
            { label: '⚡ Fill Energy', action: () => send(99, { type: 'dev_fill_energy' }) },
            { label: '🌿 Fill Biomass', action: () => send(99, { type: 'dev_fill_biomass' }) },
            {
              label: '💀 Kill Plant',
              action: () => {
                if (confirm('Kill plant?')) send(99, { type: 'dev_kill_plant' });
              },
              danger: true,
            },
          ]),
        ]);
      },
    },
    {
      id: 'render',
      label: 'Render',
      icon: '🎨',
      build: (container, cfg) => {
        const pr = cfg.plantRenderer;
        addSection(container, 'Quality', [
          createSelect(
            'Preset',
            () => 'high',
            (v) => pr.setQuality(v as 'low' | 'medium' | 'high' | 'ultra'),
            [
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'ultra', label: 'Ultra' },
            ],
          ),
        ]);
        addSection(container, 'LOD Distances', [
          createNumberInput(
            'L0',
            () => {
              const rc = pr.getConfig();
              return rc.l0Distance ?? 50;
            },
            (v) => pr.setLODDistances(v, 150, 500),
            10,
            200,
            5,
            'm',
          ),
          createNumberInput(
            'L1',
            () => {
              const rc = pr.getConfig();
              return rc.l1Distance ?? 150;
            },
            (v) => pr.setLODDistances(50, v, 500),
            50,
            500,
            10,
            'm',
          ),
          createNumberInput(
            'L2',
            () => {
              const rc = pr.getConfig();
              return rc.l2Distance ?? 500;
            },
            (v) => pr.setLODDistances(50, 150, v),
            200,
            2000,
            50,
            'm',
          ),
        ]);
        addSection(container, 'Raymarch Steps', [
          createNumberInput(
            'L0 Steps',
            () => {
              const rc = pr.getConfig();
              return rc.l0RaymarchSteps ?? 16;
            },
            (v) => pr.setRaymarchSteps(v, 10, 6),
            8,
            64,
            1,
          ),
          createNumberInput(
            'L1 Steps',
            () => {
              const rc = pr.getConfig();
              return rc.l1RaymarchSteps ?? 10;
            },
            (v) => pr.setRaymarchSteps(16, v, 6),
            6,
            32,
            1,
          ),
          createNumberInput(
            'L2 Steps',
            () => {
              const rc = pr.getConfig();
              return rc.l2RaymarchSteps ?? 6;
            },
            (v) => pr.setRaymarchSteps(16, 10, v),
            4,
            16,
            1,
          ),
        ]);
        addSection(container, 'Visual', [
          createNumberInput(
            'Smin Blend',
            () => {
              const rc = pr.getConfig();
              return rc.sminBlendRadius ?? 0.25;
            },
            () => {},
            0.02,
            0.5,
            0.01,
          ),
          createNumberInput(
            'Wind Strength',
            () => {
              const rc = pr.getConfig();
              return rc.windStrength ?? 0.3;
            },
            (v) => pr.setWindStrength(v),
            0,
            2,
            0.01,
            '×',
          ),
          createNumberInput(
            'Wind Speed',
            () => {
              const rc = pr.getConfig();
              return rc.windSpeed ?? 1.0;
            },
            (v) => pr.setWindSpeed(v),
            0.1,
            5,
            0.01,
            '×',
          ),
          createNumberInput(
            'Health Tint',
            () => {
              const rc = pr.getConfig();
              return rc.healthTintStrength ?? 0.5;
            },
            (v) => pr.setHealthTint(v),
            0,
            1,
            0.01,
            '×',
          ),
          createButtonGroup('Apply', [
            {
              label: 'Apply Render',
              action: () => {
                const l0 =
                  (document.getElementById('dev-render-l0') as HTMLInputElement)?.valueAsNumber ??
                  50;
                const l1 =
                  (document.getElementById('dev-render-l1') as HTMLInputElement)?.valueAsNumber ??
                  150;
                const l2 =
                  (document.getElementById('dev-render-l2') as HTMLInputElement)?.valueAsNumber ??
                  500;
                pr.setLODDistances(l0, l1, l2);
                const s0 =
                  (document.getElementById('dev-render-s0') as HTMLInputElement)?.valueAsNumber ??
                  16;
                const s1 =
                  (document.getElementById('dev-render-s1') as HTMLInputElement)?.valueAsNumber ??
                  10;
                const s2 =
                  (document.getElementById('dev-render-s2') as HTMLInputElement)?.valueAsNumber ??
                  6;
                pr.setRaymarchSteps(s0, s1, s2);
              },
              primary: true,
            },
          ]),
        ]);
      },
    },
    {
      id: 'camera',
      label: 'Camera',
      icon: '📷',
      build: (container, cfg) => {
        const cam = cfg.camera;
        addSection(container, 'Settings', [
          createNumberInput(
            'Smoothing',
            () => 0.05,
            (v) => cam.setSmoothing(v),
            0,
            0.5,
            0.01,
          ),
          createNumberInput(
            'Min Distance',
            () => 10,
            (v) => {
              const max =
                (document.getElementById('dev-cam-max') as HTMLInputElement)?.valueAsNumber ?? 200;
              cam.setBounds(v, max);
            },
            1,
            100,
            1,
            'm',
          ),
          createNumberInput(
            'Max Distance',
            () => 200,
            (v) => {
              const min =
                (document.getElementById('dev-cam-min') as HTMLInputElement)?.valueAsNumber ?? 10;
              cam.setBounds(min, v);
            },
            50,
            1000,
            10,
            'm',
          ),
        ]);
        addSection(container, 'Presets', [
          createButtonGroup('Quick', [
            { label: 'Top Down', action: () => cam.setDistance(150) },
            { label: 'Side View', action: () => cam.setDistance(80) },
            { label: 'Close Up', action: () => cam.setDistance(20) },
            { label: 'Far View', action: () => cam.setDistance(300) },
          ]),
          createButtonGroup('Reset', [
            {
              label: 'Reset Defaults',
              action: () => {
                cam.setBounds(10, 200);
                cam.setSmoothing(0.05);
              },
            },
          ]),
        ]);
      },
    },
    {
      id: 'simulation',
      label: 'Simulation',
      icon: '⚙️',
      build: (container, cfg) => {
        const send = cfg.sendToServer;
        addSection(container, 'Control', [
          createNumberInput(
            'Tick Rate (Hz)',
            () => 20,
            (v) => send(99, { type: 'dev_set_tick_rate', rate: v }),
            10,
            60,
            1,
          ),
          createButtonGroup('Control', [
            { label: '⏸ Pause', action: () => send(99, { type: 'dev_pause_simulation' }) },
            { label: '▶ Resume', action: () => send(99, { type: 'dev_resume_simulation' }) },
            { label: '⏭ Step Once', action: () => send(99, { type: 'dev_step_simulation' }) },
          ]),
        ]);
        addSection(container, 'Interest', [
          createNumberInput(
            'Cell Size',
            () => 64,
            (v) => send(99, { type: 'dev_set_simulation', cell_size: v }),
            16,
            256,
            16,
            'm',
          ),
          createNumberInput(
            'Ring Radius',
            () => 1,
            (v) => send(99, { type: 'dev_set_simulation', interest_ring_radius: v }),
            0,
            3,
            1,
          ),
          createNumberInput(
            'Active Hz',
            () => 20,
            (v) => send(99, { type: 'dev_set_simulation', active_tick_rate_hz: v }),
            10,
            60,
            1,
          ),
          createNumberInput(
            'Near Hz',
            () => 5,
            (v) => send(99, { type: 'dev_set_simulation', near_tick_rate_hz: v }),
            1,
            20,
            1,
          ),
          createNumberInput(
            'Dormant Interval (s)',
            () => 30,
            (v) => send(99, { type: 'dev_set_simulation', dormant_step_interval_sec: v }),
            10,
            300,
            10,
          ),
          createNumberInput(
            'Offline Damage ×',
            () => 1.0,
            (v) => send(99, { type: 'dev_set_simulation', offline_damage_multiplier: v }),
            0,
            1,
            0.01,
          ),
          createButtonGroup('Apply', [
            {
              label: 'Apply',
              action: () => {
                send(99, {
                  type: 'dev_set_simulation',
                  cell_size: (document.getElementById('dev-cell-size') as HTMLInputElement)?.value,
                  interest_ring_radius: (
                    document.getElementById('dev-interest-radius') as HTMLInputElement
                  )?.value,
                  active_tick_rate_hz: (
                    document.getElementById('dev-active-tick') as HTMLInputElement
                  )?.value,
                  near_tick_rate_hz: (document.getElementById('dev-near-tick') as HTMLInputElement)
                    ?.value,
                  dormant_step_interval_sec: (
                    document.getElementById('dev-dormant-interval') as HTMLInputElement
                  )?.value,
                  offline_damage_multiplier: (
                    document.getElementById('dev-offline-damage') as HTMLInputElement
                  )?.value,
                });
              },
              primary: true,
            },
          ]),
        ]);
        addSection(container, 'Persistence', [
          createButtonGroup('Data', [
            { label: '💾 Force Save', action: () => send(99, { type: 'dev_force_save' }) },
            {
              label: '🗑️ Clear All',
              action: () => {
                if (confirm('Clear ALL persistence?')) send(99, { type: 'dev_clear_persistence' });
              },
              danger: true,
            },
          ]),
        ]);
      },
    },
    {
      id: 'debug',
      label: 'Debug',
      icon: '🐛',
      build: (container, cfg) => {
        const send = cfg.sendToServer;
        const ps = config.plantState;
        const getPlant = () => {
          const id = ps.getPlantId();
          return id ? { id, nodes: ps.getPlantNodes() } : null;
        };
        addSection(container, 'Logging', [
          createButtonGroup('Log', [
            {
              label: '📊 Client State',
              action: () => {
                console.log('Plant:', getPlant());
              },
            },
            { label: '🌿 Server Plants', action: () => send(99, { type: 'dev_log_plants' }) },
            { label: '📦 Resources', action: () => send(99, { type: 'dev_log_resources' }) },
            { label: '📡 Network', action: () => send(99, { type: 'dev_log_network' }) },
            { label: '🧹 Clear Console', action: () => console.clear() },
            {
              label: '📤 Export JSON',
              action: () => {
                const plant = {
                  plantId: config.plantState.getPlantId(),
                  nodes: Array.from(config.plantState.getPlantNodes()?.values() ?? []),
                  timestamp: Date.now(),
                };
                const blob = new Blob([JSON.stringify(plant, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `plant-legacy-state-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              },
            },
          ]),
        ]);
        addSection(container, 'Renderer', [
          createButtonGroup('GPU', [
            { label: '🔄 Toggle WebGPU', action: () => send(99, { type: 'dev_toggle_webgpu' }) },
            {
              label: '🔧 Reinit Renderer',
              action: () => send(99, { type: 'dev_reinit_renderer' }),
            },
            { label: '📝 Dump Shaders', action: () => send(99, { type: 'dev_dump_shaders' }) },
          ]),
        ]);
        addSection(container, 'Stress Test', [
          createButtonGroup('Load', [
            {
              label: '100 Plants',
              action: () => send(99, { type: 'dev_stress_test', count: 100 }),
            },
            {
              label: '500 Plants',
              action: () => send(99, { type: 'dev_stress_test', count: 500 }),
            },
            {
              label: '1000 Plants',
              action: () => send(99, { type: 'dev_stress_test', count: 1000 }),
            },
          ]),
        ]);
      },
    },
  ];

  // ===== UI HELPERS =====
  function addSection(container: HTMLElement, title: string, elements: HTMLElement[]): void {
    const section = document.createElement('div');
    section.style.marginBottom = '16px';
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText =
      'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--leaf-500);margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--bark-700)';
    section.appendChild(titleEl);
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '8px';
    elements.forEach((el) => {
      wrapper.appendChild(el);
    });
    section.appendChild(wrapper);
    container.appendChild(section);
  }

  function createNumberInput(
    labelText: string,
    getter: () => number,
    setter: (v: number) => void,
    min: number,
    max: number,
    step: number,
    unit = '',
  ): HTMLElement {
    const numRow = document.createElement('div');
    numRow.style.display = 'flex';
    numRow.style.alignItems = 'center';
    numRow.style.gap = '10px';
    numRow.style.flexWrap = 'wrap';
    const labelEl = document.createElement('span');
    labelEl.textContent = labelText;
    labelEl.style.cssText = 'color:var(--bark-200);font-size:11px;min-width:110px';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(getter());
    input.style.cssText =
      'flex:1;min-width:100px;max-width:200px;background:var(--bark-900);border:1px solid var(--bark-600);color:var(--bone-100);padding:6px 10px;border-radius:4px;font-family:inherit;font-size:11px';
    input.onchange = () => setter(input.valueAsNumber);
    if (unit) {
      const unitEl = document.createElement('span');
      unitEl.textContent = unit;
      unitEl.style.cssText = 'color:var(--bark-300);font-size:10px;min-width:30px;text-align:right';
      numRow.appendChild(labelEl);
      numRow.appendChild(input);
      numRow.appendChild(unitEl);
    } else {
      numRow.appendChild(labelEl);
      numRow.appendChild(input);
    }
    return numRow;
  }

  function createSelect(
    labelText: string,
    getter: () => string,
    setter: (v: string) => void,
    options: { value: string; label: string }[],
  ): HTMLElement {
    const selRow = document.createElement('div');
    selRow.style.display = 'flex';
    selRow.style.alignItems = 'center';
    selRow.style.gap = '10px';
    selRow.style.flexWrap = 'wrap';
    const selLabelEl = document.createElement('span');
    selLabelEl.textContent = labelText;
    selLabelEl.style.cssText = 'color:var(--bark-200);font-size:11px;min-width:110px';
    const select = document.createElement('select');
    select.style.cssText =
      'flex:1;min-width:120px;background:var(--bark-900);border:1px solid var(--bark-600);color:var(--bone-100);padding:6px 10px;border-radius:4px;font-family:inherit;font-size:11px';
    options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    select.value = getter();
    select.onchange = () => setter(select.value);
    selRow.appendChild(selLabelEl);
    selRow.appendChild(select);
    return selRow;
  }

  function createToggle(
    labelText: string,
    getter: () => boolean,
    setter: (v: boolean) => void,
  ): HTMLElement {
    const togRow = document.createElement('div');
    togRow.style.display = 'flex';
    togRow.style.alignItems = 'center';
    togRow.style.gap = '10px';
    const togLabelEl = document.createElement('span');
    togLabelEl.textContent = labelText;
    togLabelEl.style.cssText = 'color:var(--bark-200);font-size:11px;min-width:110px';
    const toggle = document.createElement('label');
    toggle.style.cssText =
      'width:44px;height:24px;background:var(--bark-700);border:1px solid var(--bark-600);border-radius:12px;position:relative;cursor:pointer;transition:all 0.15s';
    const thumb = document.createElement('span');
    thumb.style.cssText =
      'position:absolute;top:2px;left:2px;width:18px;height:18px;background:var(--bone-100);border-radius:50%;transition:transform 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.3)';
    toggle.appendChild(thumb);
    const update = () => {
      const active = getter();
      toggle.classList.toggle('dp-toggle-active', active);
      toggle.style.background = active ? 'var(--leaf-500)' : 'var(--bark-700)';
      toggle.style.borderColor = active ? 'var(--leaf-400)' : 'var(--bark-600)';
      thumb.style.transform = active ? 'translateX(20px)' : 'translateX(0)';
    };
    update();
    toggle.onclick = () => setter(!getter());
    toggle.style.cssText +=
      ';display:flex;align-items:center;justify-content:flex-start;padding:0 2px';
    const togWrapperRow = document.createElement('div');
    togWrapperRow.style.display = 'flex';
    togWrapperRow.style.alignItems = 'center';
    togWrapperRow.style.gap = '10px';
    const togWrapperLabelEl = document.createElement('span');
    togWrapperLabelEl.textContent = labelText;
    togWrapperLabelEl.style.cssText = 'color:var(--bark-200);font-size:11px;min-width:110px';
    togWrapperRow.appendChild(togWrapperLabelEl);
    togWrapperRow.appendChild(toggle);
    return togWrapperRow;
  }

  function createReadonly(labelText: string, getter: () => string | number): HTMLElement {
    const roRow = document.createElement('div');
    roRow.style.display = 'flex';
    roRow.style.alignItems = 'center';
    roRow.style.gap = '10px';
    const roLabelEl = document.createElement('span');
    roLabelEl.textContent = labelText;
    roLabelEl.style.cssText = 'color:var(--bark-200);font-size:11px;min-width:110px';
    const val = document.createElement('span');
    val.textContent = String(getter());
    val.style.cssText =
      'flex:1;text-align:right;color:var(--bark-100);font-family:inherit;font-size:11px;min-width:100px';
    roRow.appendChild(roLabelEl);
    roRow.appendChild(val);
    return roRow;
  }

  function createButtonGroup(
    _labelText: string,
    buttons: { label: string; action: () => void; primary?: boolean; danger?: boolean }[],
  ): HTMLElement {
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';
    btnGroup.style.flexWrap = 'wrap';
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.style.cssText = `
        background:${b.primary ? 'var(--leaf-600)' : b.danger ? '#8b3a3a' : 'var(--bark-800)'};
        border:1px solid ${b.primary ? 'var(--leaf-500)' : b.danger ? '#a84a4a' : 'var(--bark-600)'};
        color:${b.primary ? 'var(--bark-900)' : b.danger ? '#ffd0d0' : 'var(--bone-100)'};
        padding:6px 12px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;
        transition:all 0.1s;${b.primary ? 'font-weight:600' : ''}
      `;
      btn.onmouseenter = () => {
        if (b.primary) btn.style.background = 'var(--leaf-500)';
        else if (b.danger) btn.style.background = '#a84a4a';
        else btn.style.background = 'var(--bark-700)';
      };
      btn.onmouseleave = () => {
        if (b.primary) btn.style.background = 'var(--leaf-600)';
        else if (b.danger) btn.style.background = '#8b3a3a';
        else btn.style.background = 'var(--bark-800)';
      };
      btn.onclick = b.action;
      btnGroup.appendChild(btn);
    });
    return btnGroup;
  }

  // ===== RENDER & EVENTS =====
  function renderTabs(): void {
    tabsEl.innerHTML = '';
    tabs.forEach((tab) => {
      const btn = document.createElement('button');
      btn.className = `dp-tab${tab.id === activeTab ? ' active' : ''}`;
      btn.innerHTML = `${tab.icon} ${tab.label}`;
      btn.dataset.tab = tab.id;
      btn.style.cssText = `
        padding:8px 14px;
        cursor:pointer;
        color:var(--bark-300);
        border-radius:6px;
        white-space:nowrap;
        font-size:10px;
        text-transform:uppercase;
        letter-spacing:0.5px;
        transition:all 0.15s;
        display:flex;
        align-items:center;
        gap:6px;
        background:transparent;
        border:1px solid transparent;
      `;
      btn.onmouseenter = () => {
        if (tab.id !== activeTab) {
          btn.style.background = 'rgba(74,96,54,0.2)';
          btn.style.color = 'var(--leaf-300)';
          btn.style.borderColor = 'var(--bark-500)';
        }
      };
      btn.onmouseleave = () => {
        if (tab.id !== activeTab) {
          btn.style.background = 'transparent';
          btn.style.color = 'var(--bark-300)';
          btn.style.borderColor = 'transparent';
        }
      };
      btn.onclick = () => switchTab(tab.id);
      tabsEl.appendChild(btn);
    });
  }

  function switchTab(tabId: TabId): void {
    activeTab = tabId;
    renderTabs();
    renderContent();
  }

  function renderContent(): void {
    contentEl.innerHTML = '';
    const tab = tabs.find((t) => t.id === activeTab);
    if (!tab) return;

    searchEl.placeholder = `Search ${tab.label}...`;
    searchEl.value = searchQuery;
    searchEl.style.display = 'block';

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    tab.build(container, config);
    contentEl.appendChild(container);
    filterEntries();
  }

  function filterEntries(): void {
    const entries = contentEl.querySelectorAll('.dp-entry');
    const q = searchQuery.toLowerCase();
    entries.forEach((el) => {
      const text = el.textContent?.toLowerCase() ?? '';
      (el as HTMLElement).style.display = q === '' || text.includes(q) ? '' : 'none';
    });
  }

  // ===== DRAG / MINIMIZE / CLOSE =====
  headerEl.onmousedown = (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.offsetLeft;
    dragOffsetY = e.clientY - panel.offsetTop;
    headerEl.style.cursor = 'grabbing';
    e.preventDefault();
  };
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = `${e.clientX - dragOffsetX}px`;
    panel.style.top = `${e.clientY - dragOffsetY}px`;
    panel.style.right = 'auto';
    panel.style.transform = 'none';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      headerEl.style.cursor = 'grab';
    }
  });

  minimizeBtn.onclick = () => {
    isMinimized = !isMinimized;
    panel.classList.toggle('dp-minimized', isMinimized);
    minimizeBtn.textContent = isMinimized ? '+' : '−';
  };

  closeBtn.onclick = hide;

  searchEl.oninput = (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    filterEntries();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && visible) hide();
  });

  // ===== API =====
  function show(): void {
    visible = true;
    panel.style.display = 'block';
    document.body.style.overflow = 'hidden';
    searchEl.style.display = 'block';
    renderTabs();
    renderContent();
    setTimeout(() => searchEl.focus(), 50);
  }

  function hide(): void {
    visible = false;
    panel.style.display = 'none';
    document.body.style.overflow = '';
  }

  function toggle(): void {
    if (visible) hide();
    else show();
  }

  function isVisible(): boolean {
    return visible;
  }

  function updateTileInfo(
    tileX: number,
    tileZ: number,
    _resources: { light: number; moisture: number; minerals: number },
  ): void {
    state.currentTile = { x: tileX, z: tileZ };
  }

  // Initial render
  renderTabs();
  renderContent();

  return { panel, show, hide, toggle, isVisible, updateTileInfo };
}
