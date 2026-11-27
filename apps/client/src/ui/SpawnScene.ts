/**
 * The seed/spawn scene.
 *
 * Opened by Play before the socket and by "Grow again" after a death. It is a
 * full-screen place, not a modal card: the title's sky and soil, seed cards on
 * the ground, and a map of the playable disc. The server is still the authority;
 * this scene only drafts a selection and shows its price.
 */
import {
  formatGeodetic,
  geodeticToLocal,
  localToGeodetic,
  type SpawnSelection,
} from '@plant-legacy/shared/world';
import { escapeHtml } from './escape.ts';
import {
  canAfford,
  chooseArchetype,
  chooseArea,
  chooseMode,
  createSpawnDraft,
  insufficientMessage,
  resolveDraft,
  type SpawnDraft,
  type SpawnSceneOptions,
  selectedArea,
  setCoordinateText,
} from './spawnSceneModel.ts';

export interface SpawnSceneCallbacks {
  onConfirm(selection: SpawnSelection, cost: number): void;
  onCancel(): void;
}

export interface SpawnSceneOptions2 {
  mount: HTMLElement;
  mode: 'new' | 'respawn';
  loadOptions: () => Promise<SpawnSceneOptions>;
  callbacks: SpawnSceneCallbacks;
}

const STYLE_ID = 'pl-spawn-scene-style';

const STYLE = `
  .pl-spawn {
    position: absolute; inset: 0; z-index: 3;
    /* Mounted in the modal UI layer, which is pointer-events: none so the world
       stays draggable. The scene is a modal and has to opt back in. */
    pointer-events: auto;
    display: flex; flex-direction: column;
    overflow: hidden;
    color: var(--warm-ink, #f0ead6);
    background:
      radial-gradient(ellipse 120% 80% at 50% 108%, #2b2117 0 48%, transparent 70%),
      linear-gradient(180deg, #101b22 0%, #1c2b2e 44%, #3a3324 68%, #241a12 100%);
    font-family: inherit;
    isolation: isolate;
  }
  .pl-spawn::before {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(circle at 22% 18%, rgba(220, 234, 201, 0.13), transparent 40%),
      radial-gradient(circle at 78% 30%, rgba(220, 234, 201, 0.08), transparent 45%);
  }
  .pl-spawn__skyline { position: absolute; left: 0; right: 0; bottom: 0; height: 34%; pointer-events: none; opacity: .85; }
  .pl-spawn__inner {
    position: relative; z-index: 1; width: min(1180px, calc(100vw - 32px));
    margin: 0 auto; padding: 22px 0 18px; display: flex; flex-direction: column;
    flex: 1; min-height: 0;
  }
  .pl-spawn__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .pl-spawn__eyebrow {
    margin: 0; font-size: .66rem; letter-spacing: .24em; text-transform: uppercase;
    color: #cbd7a8; opacity: .8;
  }
  .pl-spawn h1 {
    margin: 4px 0 4px; font-size: clamp(1.5rem, 3.2vw, 2.4rem); font-weight: 600;
    letter-spacing: -.02em;
  }
  .pl-spawn__lede { margin: 0; max-width: 62ch; color: #d5d5bd; opacity: .78; font-size: .9rem; }
  .pl-spawn__balance {
    flex: none; padding: 8px 13px; border: 1px solid rgba(220, 226, 184, .3);
    border-radius: 999px; background: rgba(8, 14, 12, .5); font-size: .78rem;
    letter-spacing: .03em; white-space: nowrap;
  }
  .pl-spawn__balance strong { color: #e9e2ac; font-weight: 600; }
  .pl-spawn__body {
    margin-top: 14px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .75fr);
    gap: 14px; min-height: 0; flex: 1;
  }
  .pl-spawn__panel {
    min-height: 0; overflow: auto; scrollbar-width: thin;
    border: 1px solid rgba(197, 206, 166, .17); border-radius: 12px;
    background: rgba(10, 17, 14, .46);
    padding: 13px;
  }
  .pl-spawn h2 {
    margin: 0 0 3px; font-size: .72rem; letter-spacing: .15em; text-transform: uppercase;
    color: #c6d3a0; font-weight: 600;
  }
  .pl-spawn__hint { margin: 0 0 10px; color: #b9bda8; font-size: .76rem; line-height: 1.35; }
  .pl-spawn__archetypes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .pl-spawn__seed {
    position: relative; display: flex; flex-direction: column; gap: 5px; text-align: left;
    min-height: 132px; padding: 10px; border-radius: 10px; cursor: pointer;
    color: inherit; font: inherit; background: rgba(23, 32, 24, .72);
    border: 1px solid rgba(207, 216, 174, .18); transition: transform 120ms ease, border-color 120ms ease;
  }
  .pl-spawn__seed:hover, .pl-spawn__seed:focus-visible {
    transform: translateY(-2px); border-color: rgba(238, 226, 154, .62); outline: none;
  }
  .pl-spawn__seed[aria-pressed='true'] {
    border-color: #e7dd93; background: rgba(55, 61, 35, .88);
    box-shadow: inset 0 0 0 1px rgba(231, 221, 147, .3);
  }
  .pl-spawn__seed svg { width: 26px; height: 32px; margin-bottom: 2px; }
  .pl-spawn__seed b { font-size: .86rem; font-weight: 600; }
  .pl-spawn__seed span { font-size: .72rem; line-height: 1.32; opacity: .76; }
  .pl-spawn__stats { margin-top: auto; display: flex; gap: 6px; flex-wrap: wrap; font-size: .64rem; opacity: .7; }
  .pl-spawn__stats i { font-style: normal; }
  .pl-spawn__modes { display: flex; gap: 6px; margin: 12px 0 9px; flex-wrap: wrap; }
  .pl-spawn__mode {
    border: 1px solid rgba(207, 216, 174, .23); border-radius: 999px; cursor: pointer;
    background: transparent; color: #d9dcc8; font: inherit; font-size: .74rem; padding: 6px 11px;
  }
  .pl-spawn__mode[aria-pressed='true'] { background: #d8d293; color: #171b10; border-color: #d8d293; }
  .pl-spawn__random {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    border: 1px solid rgba(157, 185, 111, .34); border-radius: 9px; padding: 11px 12px;
    background: rgba(45, 61, 35, .52);
  }
  .pl-spawn__random p { margin: 0; font-size: .8rem; line-height: 1.4; }
  .pl-spawn__random strong { color: #cfe8a5; }
  .pl-spawn__free { flex: none; color: #cfe8a5; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
  .pl-spawn__areas { display: grid; gap: 6px; margin-top: 9px; }
  .pl-spawn__area {
    display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; text-align: left;
    padding: 9px 10px; border-radius: 8px; border: 1px solid rgba(207, 216, 174, .16);
    background: rgba(24, 34, 25, .55); color: inherit; font: inherit; cursor: pointer;
  }
  .pl-spawn__area:hover, .pl-spawn__area:focus-visible { border-color: rgba(237, 226, 156, .55); outline: none; }
  .pl-spawn__area[aria-pressed='true'] { border-color: #e7dd93; background: rgba(58, 62, 35, .88); }
  .pl-spawn__area b { font-size: .79rem; font-weight: 600; }
  .pl-spawn__area em { grid-column: 1; font-style: normal; opacity: .67; font-size: .69rem; }
  .pl-spawn__area span { grid-column: 2; grid-row: 1 / span 2; align-self: center; color: #d9d293; font-size: .72rem; }
  .pl-spawn__exact { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
  .pl-spawn__exact label { display: flex; flex-direction: column; gap: 3px; font-size: .68rem; color: #c6c9b2; }
  .pl-spawn__exact input {
    width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 7px;
    border: 1px solid rgba(207, 216, 174, .27); background: rgba(7, 12, 9, .65);
    color: inherit; font: inherit; font-size: .78rem;
  }
  .pl-spawn__exact input:focus { outline: none; border-color: #e7dd93; }
  .pl-spawn__map { position: relative; aspect-ratio: 1; max-height: 42vh; margin: 2px auto 0; }
  .pl-spawn__map svg { width: 100%; height: 100%; display: block; }
  .pl-spawn__map-caption { text-align: center; font-size: .68rem; opacity: .62; margin-top: 4px; }
  .pl-spawn__error { min-height: 1.2em; margin: 7px 0 0; color: #f0b9a4; font-size: .76rem; }
  .pl-spawn__foot { display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 11px; flex: none; }
  .pl-spawn__back, .pl-spawn__confirm {
    font: inherit; cursor: pointer; border-radius: 8px; padding: 9px 15px; font-size: .82rem;
  }
  .pl-spawn__back { background: transparent; color: #d8d9c5; border: 1px solid rgba(207, 216, 174, .32); }
  .pl-spawn__confirm { background: #d8d293; color: #141910; border: 1px solid #d8d293; font-weight: 600; }
  .pl-spawn__confirm:disabled { opacity: .42; cursor: not-allowed; }
  .pl-spawn__loading { display: grid; place-items: center; flex: 1; font-size: .9rem; opacity: .8; }
  @media (max-width: 780px) {
    .pl-spawn__body { grid-template-columns: 1fr; overflow: auto; }
    .pl-spawn__panel { overflow: visible; }
    .pl-spawn__archetypes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pl-spawn__map { max-height: 32vh; }
  }
`;

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function seedArt(color: string): string {
  return `<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M13 1C7 7 3 12 3 18a10 10 0 0 0 20 0c0-6-4-11-10-17Z" fill="${color}" opacity=".92"/><path d="M13 9v17M13 15c-3-2-5-5-6-8M13 20c3-2 5-5 6-9" stroke="#1d2417" stroke-width="1.2" fill="none" opacity=".45"/></svg>`;
}

function statLine(label: string, value: number): string {
  const pct = Math.round(value * 100);
  return `<i>${label} ${pct}%</i>`;
}

export class SpawnScene {
  private readonly options: SpawnSceneOptions2;
  private readonly root: HTMLDivElement;
  private data: SpawnSceneOptions | null = null;
  private draft: SpawnDraft | null = null;
  private destroyed = false;
  private error: string | null = null;

  constructor(options: SpawnSceneOptions2) {
    installStyle();
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'pl-spawn';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Choose a seed');
    options.mount.appendChild(this.root);
    this.renderLoading();
    void this.load();
    this.root.addEventListener('keydown', this.onKeyDown);
  }

  private async load(): Promise<void> {
    try {
      const data = await this.options.loadOptions();
      if (this.destroyed) return;
      this.data = data;
      this.draft = createSpawnDraft(data);
      this.error =
        data.archetypes.length === 0
          ? 'The seed bed is empty. The server has no archetypes.'
          : null;
      this.render();
    } catch (error) {
      if (this.destroyed) return;
      this.error = `Could not read the seed bed: ${error instanceof Error ? error.message : String(error)}`;
      this.renderLoading();
    }
  }

  private renderLoading(): void {
    this.root.innerHTML = `
      <div class="pl-spawn__inner">
        <div class="pl-spawn__loading">
          <p>${this.error ? escapeHtml(this.error) : 'Reading the seed bed…'}</p>
        </div>
        <div class="pl-spawn__foot">
          <button class="pl-spawn__back" type="button" data-action="cancel">Back</button>
        </div>
      </div>`;
    this.root
      .querySelector<HTMLElement>('[data-action="cancel"]')
      ?.addEventListener('click', () => {
        this.options.callbacks.onCancel();
      });
  }

  private render(): void {
    const data = this.data;
    const draft = this.draft;
    if (!data || !draft) return;
    const area = selectedArea(draft, data);
    const decision = resolveDraft(draft, data);
    const affordable = canAfford(decision, data);
    const message = !decision.ok
      ? decision.message
      : !affordable
        ? insufficientMessage(decision, data)
        : this.error;

    this.root.innerHTML = `
      <div class="pl-spawn__inner">
        <div class="pl-spawn__top">
          <div>
            <p class="pl-spawn__eyebrow">${this.options.mode === 'respawn' ? 'A new seed' : 'Plant Legacy'}</p>
            <h1>${this.options.mode === 'respawn' ? 'Where will the next one start?' : 'Choose what wakes up'}</h1>
            <p class="pl-spawn__lede">Every seed grows the same plant and leans it differently. Wild ground is free. A named place or an exact latitude and longitude costs spores.</p>
          </div>
          <div class="pl-spawn__balance">Spores <strong>${Math.max(0, data.balance)}</strong></div>
        </div>
        <div class="pl-spawn__body">
          <section class="pl-spawn__panel" aria-labelledby="pl-spawn-archetypes">
            <h2 id="pl-spawn-archetypes">The seed</h2>
            <p class="pl-spawn__hint">These are multipliers on the same plant, not separate species.</p>
            <div class="pl-spawn__archetypes">
              ${data.archetypes
                .map(
                  (archetype) => `
                <button class="pl-spawn__seed" type="button" data-archetype="${escapeHtml(archetype.id)}"
                  aria-pressed="${archetype.id === draft.archetypeId}">
                  ${seedArt(escapeHtml(archetype.color))}
                  <b>${escapeHtml(archetype.name)}</b>
                  <span>${escapeHtml(archetype.description)}</span>
                  <span class="pl-spawn__stats">
                    ${statLine('Growth', archetype.growthSpeed)}
                    ${statLine('Water', archetype.waterCapacity)}
                    ${statLine('Light', archetype.photosynthesis)}
                    ${statLine('Upkeep', archetype.upkeep)}
                  </span>
                </button>`,
                )
                .join('')}
            </div>

            <div class="pl-spawn__modes" role="group" aria-label="Where to plant">
              <button class="pl-spawn__mode" type="button" data-mode="random" aria-pressed="${draft.mode === 'random'}">Wild ground</button>
              <button class="pl-spawn__mode" type="button" data-mode="area" aria-pressed="${draft.mode === 'area'}">Named area</button>
              <button class="pl-spawn__mode" type="button" data-mode="exact" aria-pressed="${draft.mode === 'exact'}">Exact coordinate</button>
            </div>

            ${
              draft.mode === 'random'
                ? `<div class="pl-spawn__random"><p><strong>Random spawn.</strong> The server finds clear ground inside the ${data.playRadiusM} m radius survey.</p><span class="pl-spawn__free">Free</span></div>`
                : ''
            }
            ${
              draft.mode === 'area'
                ? `<div class="pl-spawn__areas">${data.namedAreas
                    .map(
                      (entry) => `
                  <button class="pl-spawn__area" type="button" data-area="${escapeHtml(entry.id)}"
                    aria-pressed="${entry.id === draft.areaId}">
                    <b>${escapeHtml(entry.name)}</b>
                    <em>${escapeHtml(entry.description)}</em>
                    <span>${entry.cost} spores</span>
                  </button>`,
                    )
                    .join('')}</div>`
                : ''
            }
            ${
              draft.mode === 'exact'
                ? `<form class="pl-spawn__exact" data-form="exact">
                  <label>Latitude<input name="latitude" inputmode="text" autocomplete="off"
                    placeholder="89.82 N" value="${escapeHtml(draft.latitudeText)}"></label>
                  <label>Longitude<input name="longitude" inputmode="text" autocomplete="off"
                    placeholder="0.00 E" value="${escapeHtml(draft.longitudeText)}"></label>
                  <span class="pl-spawn__free">${data.exactCoordinateCost} spores</span>
                </form>`
                : ''
            }
            <p class="pl-spawn__error" role="alert">${escapeHtml(message ?? '')}</p>
          </section>

          <section class="pl-spawn__panel" aria-labelledby="pl-spawn-map-title">
            <h2 id="pl-spawn-map-title">The survey</h2>
            <p class="pl-spawn__hint">Top-down view of the playable disc. The centre is the survey origin, north is up.</p>
            ${this.mapMarkup(data, draft, area)}
            <p class="pl-spawn__map-caption">${area ? escapeHtml(area.name) : `${data.playRadiusM} m radius · latitude near +90° N`}</p>
          </section>
        </div>
        <div class="pl-spawn__foot">
          <button class="pl-spawn__back" type="button" data-action="cancel">Back</button>
          <button class="pl-spawn__confirm" type="button" data-action="confirm"
            ${decision.ok && affordable ? '' : 'disabled'}>${escapeHtml(decision.label)}${decision.ok && decision.cost > 0 ? ` · ${decision.cost}` : ''}</button>
        </div>
      </div>
      <svg class="pl-spawn__skyline" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 150C90 120 150 160 240 128s150 30 220 6 140 22 220 4 160 22 320-20v82H0Z" fill="#1a2418" opacity=".9"/>
        <path d="M0 174C120 146 220 180 330 158s180 18 260 3 140 14 230 0 120 6 180-2v41H0Z" fill="#111a10"/>
      </svg>`;
    this.bind();
  }

  private mapMarkup(
    data: SpawnSceneOptions,
    draft: SpawnDraft,
    area: ReturnType<typeof selectedArea>,
  ): string {
    const point = (latitudeDeg: number, longitudeDeg: number): { x: number; y: number } => {
      const local = geodeticToLocal(
        { latitudeDeg, longitudeDeg, altitudeM: 0 },
        data.planetRadiusM,
      );
      const scale = 44 / Math.max(1, data.playRadiusM);
      return { x: 50 + local.x * scale, y: 50 - local.z * scale };
    };
    const areas = data.namedAreas
      .map((entry) => {
        const at = point(entry.centerLatitudeDeg, entry.centerLongitudeDeg);
        const selected = area?.id === entry.id;
        return `<circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="${selected ? 4.2 : 2.8}"
          fill="${selected ? '#e9e1a0' : '#9fb47a'}" stroke="#141a10" stroke-width="1.1"></circle>
          <text x="${at.x.toFixed(2)}" y="${(at.y - 5.2).toFixed(2)}" fill="#d9dcc8"
            font-size="2.9" text-anchor="middle">${escapeHtml(entry.name.split(' ')[0])}</text>`;
      })
      .join('');
    let exact = '';
    if (draft.mode === 'exact' && draft.latitudeText && draft.longitudeText) {
      const decision = resolveDraft(draft, data);
      const lat = decision.selection?.latitudeDeg;
      const lon = decision.selection?.longitudeDeg;
      if (lat !== undefined && lon !== undefined) {
        const at = point(lat, lon);
        const coordinate = localToGeodetic(
          geodeticToLocal(
            { latitudeDeg: lat, longitudeDeg: lon, altitudeM: 0 },
            data.planetRadiusM,
          ),
          data.planetRadiusM,
        );
        exact = `<g><line x1="50" y1="50" x2="${at.x.toFixed(2)}" y2="${at.y.toFixed(2)}"
          stroke="#e9e1a0" stroke-width=".55" stroke-dasharray="1.8 1.4" opacity=".7"></line>
          <circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="3.4" fill="none" stroke="#f2e9a4" stroke-width="1.1"></circle>
          <text x="${at.x.toFixed(2)}" y="${(at.y + 6).toFixed(2)}" fill="#f2e9a4" font-size="2.7"
            text-anchor="middle">${escapeHtml(formatGeodetic(coordinate, 3))}</text></g>`;
      }
    }
    return `<div class="pl-spawn__map"><svg viewBox="0 0 100 100" role="img"
      aria-label="Map of the playable disc with named areas">
      <defs><radialGradient id="pl-spawn-disc"><stop offset="0" stop-color="#4e5634" stop-opacity=".75"/><stop offset="1" stop-color="#252c1c" stop-opacity=".8"/></radialGradient></defs>
      <circle cx="50" cy="50" r="44" fill="url(#pl-spawn-disc)" stroke="#b6c18e" stroke-width=".75" opacity=".95"/>
      <circle cx="50" cy="50" r="22" fill="none" stroke="#c7cf9f" stroke-width=".35" opacity=".25"/>
      <line x1="50" y1="4" x2="50" y2="96" stroke="#c7cf9f" stroke-width=".3" opacity=".22"/>
      <line x1="4" y1="50" x2="96" y2="50" stroke="#c7cf9f" stroke-width=".3" opacity=".22"/>
      <path d="M42 47c4-8 9-10 14-8s7 9 4 16-9 11-15 7-7-9-3-15Z" fill="#5d683c" opacity=".45"/>
      <circle cx="50" cy="50" r="1.7" fill="#d9d293"/>
      ${areas}${exact}
    </svg></div>`;
  }

  private bind(): void {
    const data = this.data;
    const draft = this.draft;
    if (!data || !draft) return;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-archetype]')) {
      button.addEventListener('click', () => {
        this.draft = chooseArchetype(this.draft ?? draft, button.dataset.archetype ?? '');
        this.error = null;
        this.render();
        this.root
          .querySelector<HTMLElement>(`[data-archetype="${CSS.escape(this.draft.archetypeId)}"]`)
          ?.focus();
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
      button.addEventListener('click', () => {
        this.draft = chooseMode(
          this.draft ?? draft,
          button.dataset.mode as 'random' | 'area' | 'exact',
        );
        this.error = null;
        this.render();
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-area]')) {
      button.addEventListener('click', () => {
        this.draft = chooseArea(this.draft ?? draft, button.dataset.area ?? '');
        this.error = null;
        this.render();
      });
    }
    const form = this.root.querySelector<HTMLFormElement>('[data-form="exact"]');
    if (form) {
      const latitude = form.querySelector<HTMLInputElement>('input[name="latitude"]');
      const longitude = form.querySelector<HTMLInputElement>('input[name="longitude"]');
      const update = () => {
        if (!this.draft) return;
        this.draft = setCoordinateText(this.draft, 'latitudeText', latitude?.value ?? '');
        this.draft = setCoordinateText(this.draft, 'longitudeText', longitude?.value ?? '');
        this.refresh();
      };
      latitude?.addEventListener('input', update);
      longitude?.addEventListener('input', update);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.confirm();
      });
    }
    this.root
      .querySelector<HTMLElement>('[data-action="cancel"]')
      ?.addEventListener('click', () => {
        this.options.callbacks.onCancel();
      });
    this.root
      .querySelector<HTMLElement>('[data-action="confirm"]')
      ?.addEventListener('click', () => this.confirm());
    const focusTarget =
      this.root.querySelector<HTMLElement>(`[data-archetype="${CSS.escape(draft.archetypeId)}"]`) ??
      this.root.querySelector<HTMLElement>('[data-action="confirm"]');
    focusTarget?.focus({ preventScroll: true });
  }

  /** Keep text inputs mounted; refresh everything that can change around them. */
  private refresh(): void {
    const data = this.data;
    const draft = this.draft;
    if (!data || !draft) return;
    const decision = resolveDraft(draft, data);
    const affordable = canAfford(decision, data);
    const confirm = this.root.querySelector<HTMLButtonElement>('[data-action="confirm"]');
    if (confirm) {
      confirm.disabled = !decision.ok || !affordable;
      confirm.textContent =
        decision.label + (decision.ok && decision.cost > 0 ? ` · ${decision.cost}` : '');
    }
    const error = this.root.querySelector<HTMLElement>('.pl-spawn__error');
    if (error) {
      error.textContent = !decision.ok
        ? (decision.message ?? '')
        : !affordable
          ? insufficientMessage(decision, data)
          : '';
    }
    const map = this.root.querySelector<HTMLElement>('.pl-spawn__map');
    if (map) map.outerHTML = this.mapMarkup(data, draft, selectedArea(draft, data));
  }

  private confirm(): void {
    const data = this.data;
    const draft = this.draft;
    if (!data || !draft) return;
    const decision = resolveDraft(draft, data);
    if (!decision.ok) {
      this.error = decision.message;
      this.render();
      return;
    }
    if (!canAfford(decision, data)) {
      this.error = insufficientMessage(decision, data);
      this.render();
      return;
    }
    if (!decision.selection) return;
    this.options.callbacks.onConfirm(decision.selection, decision.cost);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.options.callbacks.onCancel();
  };

  destroy(): void {
    this.destroyed = true;
    this.root.remove();
  }
}
