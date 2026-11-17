/**
 * C04 plant status HUD.
 *
 * Reads like body state, not a menu: biomass and its rate, rooted/uprooted
 * state, structural integrity against the uproot threshold, mutation bill, and
 * the reroot window with its controls. Every number comes from server state;
 * the client only derives the displayed rate from consecutive authoritative
 * biomass values and counts the window down between packets.
 */

import {
  DEFAULT_HEALTH_THRESHOLDS,
  type HealthThresholds,
  type PlantHealthStatus,
  plantHealthLabel,
  plantHealthStatus,
} from './plantHealth.ts';

export type PlantPhase = 'rooted' | 'uprooted' | 'tumbling' | 'rerooting';

export type RerootDirection = 'forward' | 'back' | 'left' | 'right' | 'stop';

export interface PlantStructureView {
  damageHp: number;
  threshold: number;
}

export interface PlantStatusView {
  biomass: number;
  /** Signed biomass change per second, derived from server samples. */
  biomassRatePerSecond: number | null;
  phase: PlantPhase;
  structure?: PlantStructureView;
  mutationCount: number;
  mutationUpkeepPerSecond: number;
  /** Split upkeep so the two bills are not added into one misleading number. */
  mutationEnergyUpkeepPerSecond?: number;
  mutationBiomassUpkeepPerSecond?: number;
  /** Body stores and size, for the detailed HUD readout. */
  energy?: number;
  storedWater?: number;
  waterCapacity?: number;
  storedMinerals?: number;
  mineralCapacity?: number;
  nodeCount?: number;
  /** Seconds left to reroot; null when the server is not counting one. */
  rerootWindowRemainingS: number | null;
}

export interface WeatherStatusView {
  dayNumber?: number;
  timeOfDay: number;
  isDay: boolean;
  weatherState: string;
  stateTimeRemainingS: number;
  forecast: { nextWeatherState: string; timeUntilNextStateS: number };
}

export interface PlantStatusHudOptions {
  onReroot?: (direction: RerootDirection) => void;
  /** Minimum ms between text updates (ui.hud_update_interval_ms). */
  updateIntervalMs?: number;
  /** Edge-vignette length (ui.damage_vignette_ms). */
  vignetteDurationMs?: number;
  /** Health word thresholds (ui.health_*_fraction). */
  healthThresholds?: HealthThresholds;
}

export interface PlantStatusHudAPI {
  readonly element: HTMLElement;
  update(view: PlantStatusView): void;
  setWeather(weather: WeatherStatusView): void;
  pulseDamage(): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const HEALTH_COLORS: Record<PlantHealthStatus, string> = {
  healthy: 'var(--leaf-300)',
  stressed: 'var(--gold-400)',
  withering: 'var(--ember-500)',
  dying: 'var(--ember-400)',
  dead: 'var(--ember-700)',
};

const PHASE_LABELS: Record<PlantPhase, string> = {
  rooted: 'Rooted',
  uprooted: 'Uprooted',
  tumbling: 'Tumbling',
  rerooting: 'Rerooting',
};

const WEATHER_LABELS: Record<string, string> = {
  clear: 'Clear',
  rain: 'Rain',
  thunderstorm_telegraph: 'Storm approaching',
  thunderstorm_active: 'Thunderstorm',
  thunderstorm_aftermath: 'Clearing',
};

export function phaseLabel(phase: PlantPhase): string {
  return PHASE_LABELS[phase] ?? 'Rooted';
}

export function weatherLabel(state: string): string {
  return WEATHER_LABELS[state] ?? state.replace(/_/g, ' ');
}

/** Remaining structural integrity, 0..1, from accumulated damage. */
export function structureFraction(structure: PlantStructureView): number {
  if (!(structure.threshold > 0) || !Number.isFinite(structure.threshold)) return 1;
  const damage = Number.isFinite(structure.damageHp) ? structure.damageHp : 0;
  return Math.max(0, Math.min(1, 1 - damage / structure.threshold));
}

/** 24-hour clock from the server's 0..1 day fraction. */
export function formatClock(timeOfDay: number): string {
  const clamped = Number.isFinite(timeOfDay) ? Math.min(0.9999, Math.max(0, timeOfDay)) : 0;
  const totalMinutes = Math.floor(clamped * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Seconds as m:ss, clamped at zero. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function createPlantStatusHud(options: PlantStatusHudOptions = {}): PlantStatusHudAPI {
  const panel = document.createElement('section');
  panel.id = 'plant-status-hud';
  panel.className = 'hud-panel';
  panel.setAttribute('aria-label', 'Plant status');
  Object.assign(panel.style, {
    position: 'fixed',
    top: 'var(--hud-corner)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '205',
    display: 'none',
    minWidth: 'clamp(220px, 24vw, 360px)',
    padding: '6px 10px',
    pointerEvents: 'auto',
    fontVariantNumeric: 'tabular-nums',
  });

  // Damage cue: a brief edge vignette, never a screen-wide flash (DESIGN 18.4).
  const vignette = document.createElement('div');
  vignette.setAttribute('aria-hidden', 'true');
  Object.assign(vignette.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '190',
    opacity: '0',
    boxShadow: 'inset 0 0 96px rgba(238, 112, 64, 0.55)',
    transition: 'opacity 160ms ease-out',
  });
  document.body.appendChild(vignette);

  const topLine = document.createElement('div');
  Object.assign(topLine.style, {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: '10px',
    fontSize: 'var(--hud-font-sm)',
    color: 'var(--warm-ink)',
    whiteSpace: 'nowrap',
  });
  const biomassEl = span('0.0');
  const rateEl = span('', 'opacity:0.72');
  const stateEl = span('Rooted', 'font-weight:700;color:var(--leaf-300)');
  const mutationEl = span('', 'opacity:0.72');
  topLine.append(labeled('Biomass', biomassEl), rateEl, labeled('State', stateEl), mutationEl);

  const vitalsLine = document.createElement('div');
  Object.assign(vitalsLine.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '1px 12px',
    marginTop: '4px',
    paddingTop: '4px',
    borderTop: '1px solid var(--hud-border, rgba(239,233,216,0.12))',
    fontSize: 'var(--hud-font-sm)',
    color: 'var(--ink-muted)',
    whiteSpace: 'nowrap',
  });
  const energyEl = span('0.0');
  const nodeCountEl = span('0');
  const waterEl = span('0 / 0');
  const mineralEl = span('0 / 0');
  vitalsLine.append(
    labeled('Energy', energyEl),
    labeled('Nodes', nodeCountEl),
    labeled('Water', waterEl),
    labeled('Minerals', mineralEl),
  );

  const weatherLine = document.createElement('div');
  Object.assign(weatherLine.style, {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '2px',
    fontSize: 'var(--hud-font-sm)',
    color: 'var(--ink-muted)',
    whiteSpace: 'nowrap',
  });
  const clockEl = span('');
  const weatherEl = span('');
  const forecastEl = span('', 'opacity:0.72');
  weatherLine.append(clockEl, weatherEl, forecastEl);

  const structureRow = document.createElement('div');
  Object.assign(structureRow.style, {
    display: 'none',
    alignItems: 'center',
    gap: '8px',
    marginTop: '5px',
    fontSize: 'var(--hud-font-sm)',
    color: 'var(--warm-ink)',
  });
  const structureLabel = span('Health', 'opacity:0.72;min-width:58px');
  const structureTrack = document.createElement('div');
  Object.assign(structureTrack.style, {
    position: 'relative',
    flex: '1',
    height: '5px',
    borderRadius: '3px',
    background: 'rgba(239,233,216,0.14)',
    overflow: 'hidden',
  });
  const structureFill = document.createElement('div');
  Object.assign(structureFill.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    transformOrigin: 'left center',
    background: 'linear-gradient(90deg, var(--leaf-700), var(--leaf-300))',
    transition: 'transform 160ms ease-out',
  });
  structureTrack.appendChild(structureFill);
  const structureValue = span('100%', 'min-width:36px;text-align:right');
  structureRow.append(structureLabel, structureTrack, structureValue);

  const rerootRow = document.createElement('div');
  Object.assign(rerootRow.style, {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginTop: '6px',
    paddingTop: '6px',
    borderTop: '1px solid var(--hud-border, rgba(239,233,216,0.12))',
    fontSize: 'var(--hud-font-sm)',
  });
  const rerootTimer = span('', 'min-width:64px;color:var(--gold-400)');
  const pad = document.createElement('div');
  Object.assign(pad.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 28px)',
    gridTemplateRows: 'repeat(2, 28px)',
    gap: '3px',
  });
  const buttons: HTMLButtonElement[] = [];
  const button = (label: string, direction: RerootDirection, area: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.direction = direction;
    btn.setAttribute('aria-label', `Reroot ${direction}`);
    Object.assign(btn.style, {
      gridArea: area,
      width: '28px',
      height: '28px',
      padding: '0',
      borderRadius: '6px',
      border: '1px solid var(--hud-border)',
      background: 'var(--hud-bg-hover)',
      color: 'var(--warm-ink)',
      font: 'inherit',
      lineHeight: '1',
      cursor: 'pointer',
      touchAction: 'none',
    });
    const start = (event: PointerEvent): void => {
      event.preventDefault();
      btn.setPointerCapture?.(event.pointerId);
      options.onReroot?.(direction);
    };
    const stop = (event: PointerEvent): void => {
      event.preventDefault();
      options.onReroot?.('stop');
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    buttons.push(btn);
    return btn;
  };
  pad.append(
    button('\u2191', 'forward', '1 / 2'),
    button('\u2190', 'left', '2 / 1'),
    button('\u25A0', 'stop', '2 / 2'),
    button('\u2192', 'right', '2 / 3'),
    button('\u2193', 'back', '3 / 2'),
  );
  rerootRow.append(rerootTimer, pad);

  panel.append(topLine, weatherLine, vitalsLine, structureRow, rerootRow);

  let interval: ReturnType<typeof setInterval> | null = null;
  let lastWeatherAtMs = 0;
  let weather: WeatherStatusView | null = null;
  let currentView: PlantStatusView | null = null;
  let lastRenderAtMs = 0;
  const updateIntervalMs = Math.max(50, options.updateIntervalMs ?? 100);
  const vignetteDurationMs = Math.max(100, options.vignetteDurationMs ?? 420);
  const healthThresholds = options.healthThresholds ?? DEFAULT_HEALTH_THRESHOLDS;

  const render = (): void => {
    if (!currentView) return;
    biomassEl.textContent = currentView.biomass.toFixed(1);
    rateEl.textContent =
      currentView.biomassRatePerSecond === null
        ? ''
        : `${currentView.biomassRatePerSecond >= 0 ? '+' : ''}${currentView.biomassRatePerSecond.toFixed(1)}/s`;
    if (currentView.phase === 'rooted') {
      const fraction = currentView.structure ? structureFraction(currentView.structure) : 1;
      const health = plantHealthStatus(fraction, healthThresholds);
      stateEl.textContent = plantHealthLabel(health);
      stateEl.style.color = HEALTH_COLORS[health];
    } else {
      stateEl.textContent = phaseLabel(currentView.phase);
      stateEl.style.color = 'var(--ember-400)';
    }
    const mutationEnergy =
      currentView.mutationEnergyUpkeepPerSecond ?? currentView.mutationUpkeepPerSecond;
    const mutationBiomass = currentView.mutationBiomassUpkeepPerSecond ?? 0;
    mutationEl.textContent =
      currentView.mutationCount > 0
        ? `${currentView.mutationCount} mutation${currentView.mutationCount === 1 ? '' : 's'} \u00B7 ${mutationEnergy.toFixed(2)} E/s \u00B7 ${mutationBiomass.toFixed(2)} B/s`
        : '';
    energyEl.textContent = (currentView.energy ?? 0).toFixed(1);
    nodeCountEl.textContent = String(Math.max(0, Math.round(currentView.nodeCount ?? 0)));
    waterEl.textContent = `${(currentView.storedWater ?? 0).toFixed(1)} / ${Math.round(currentView.waterCapacity ?? 0)}`;
    mineralEl.textContent = `${(currentView.storedMinerals ?? 0).toFixed(1)} / ${Math.round(currentView.mineralCapacity ?? 0)}`;

    if (currentView.structure) {
      const fraction = structureFraction(currentView.structure);
      structureRow.style.display = 'flex';
      structureFill.style.transform = `scaleX(${fraction.toFixed(4)})`;
      structureValue.textContent = `${Math.round(fraction * 100)}%`;
    } else {
      structureRow.style.display = 'none';
    }

    const rerooting = currentView.phase === 'uprooted' || currentView.phase === 'rerooting';
    rerootRow.style.display = rerooting ? 'flex' : 'none';
    rerootTimer.textContent =
      currentView.rerootWindowRemainingS === null
        ? 'Reroot'
        : `Reroot ${formatCountdown(currentView.rerootWindowRemainingS)}`;

    if (weather) {
      const elapsed = (performance.now() - lastWeatherAtMs) / 1000;
      clockEl.textContent = `Day ${weather.dayNumber ?? 1} \u00B7 ${formatClock(weather.timeOfDay)}`;
      weatherEl.textContent = weatherLabel(weather.weatherState);
      const untilNext = weather.forecast.timeUntilNextStateS - elapsed;
      forecastEl.textContent =
        untilNext > 0 && weather.forecast.nextWeatherState !== weather.weatherState
          ? `${weatherLabel(weather.forecast.nextWeatherState)} in ${formatCountdown(untilNext)}`
          : '';
    }
  };

  interval = setInterval(render, 250);

  return {
    element: panel,
    update: (view) => {
      currentView = view;
      const now = performance.now();
      // HUD values update at most 10 Hz (DESIGN 18.2); skip a render that would
      // only repaint the same numbers.
      if (now - lastRenderAtMs < updateIntervalMs) return;
      lastRenderAtMs = now;
      render();
    },
    setWeather: (next) => {
      weather = next;
      lastWeatherAtMs = performance.now();
      render();
    },
    pulseDamage: () => {
      if (
        document.documentElement.dataset.reducedMotion === 'true' ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }
      vignette.animate([{ opacity: '0' }, { opacity: '1' }, { opacity: '0' }], {
        duration: vignetteDurationMs,
        easing: 'ease-out',
      });
    },
    setVisible: (visible) => {
      panel.style.display = visible ? 'block' : 'none';
    },
    dispose: () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
      panel.remove();
      vignette.remove();
    },
  };
}

function span(text: string, extra = ''): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  if (extra) el.style.cssText = extra;
  return el;
}

function labeled(label: string, value: HTMLElement): HTMLSpanElement {
  const el = document.createElement('span');
  el.style.cssText = 'display:inline-flex;align-items:baseline;gap:4px;';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.cssText = 'opacity:0.72;';
  el.append(name, value);
  return el;
}
