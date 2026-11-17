/**
 * Entry overlay: title, sign-in, sign-up, connecting, and the "plant lost" screen.
 *
 * Rendered inside the UI shell's `modal` layer, not as an ad-hoc fixed element:
 * the shell owns the stack (modal 400 < toast 500 < debug 700), so toasts and the
 * debug overlay still sit above this screen and the HUD cannot paint over it.
 *
 * Visual language follows the HUD tokens in styles.css: loam and bark surfaces,
 * leaf and sprout accents, bone text, ember for errors. Nunito for display
 * (already loaded by index.html), Inter for body.
 *
 * DESIGN.md 18.1, 17.8; RULE_13: no editorial copy, no exclamation marks.
 */

import type { EntryFlowStateMachine } from './EntryFlowStateMachine.js';
import { type PlantStatsSummary, plantStatRows } from './plantStats.js';

export interface EntryScreenCallbacks {
  onContinue(): void;
  /** Title buttons that swap to the matching form. */
  onSignInForm(): void;
  onSignUpForm(): void;
  onSignIn(username: string, password: string): void;
  onSignUp(username: string, displayName: string, password: string): void;
  onGuest(): void;
  onReseed(): void;
  onBack(): void;
}

export interface EntryScreenOptions {
  callbacks: EntryScreenCallbacks;
  /** Layer to mount into; the UI shell's `modal` layer in production. */
  mount?: HTMLElement;
}

const STYLE_ID = 'pl-entry-style';

const SPROUT_MARK = `<svg class="pl-entry__mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="pl-leaf-a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#c8ff80"/>
      <stop offset="1" stop-color="#5a902e"/>
    </linearGradient>
    <linearGradient id="pl-leaf-b" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9ed95c"/>
      <stop offset="1" stop-color="#426520"/>
    </linearGradient>
  </defs>
  <path d="M32 58 C32 42 22 30 8 24 C16 40 24 50 32 58 Z" fill="url(#pl-leaf-a)"/>
  <path d="M32 58 C32 38 42 26 58 20 C50 38 42 50 32 58 Z" fill="url(#pl-leaf-b)"/>
  <path d="M32 58 C31 46 31 38 32 30" stroke="#f0ead6" stroke-opacity=".55" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <ellipse cx="32" cy="60" rx="9" ry="2.6" fill="#8b4513" fill-opacity=".45"/>
</svg>`;

const STYLE = `
  .pl-entry {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: clamp(14px, 3vw, 30px);
    padding-bottom: max(clamp(14px, 3vw, 30px), env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    /* The shell's layers are pointer-events: none so the canvas stays live;
       this screen is the one thing that must take input while it is up. */
    pointer-events: auto;
    color: var(--bone-100);
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: calc(15px * var(--text-scale, 1));
    line-height: 1.5;
    background:
      radial-gradient(75rem 46rem at 82% -12%, rgba(90, 144, 46, 0.22), transparent 60%),
      radial-gradient(52rem 40rem at 4% 112%, rgba(139, 69, 19, 0.24), transparent 62%),
      radial-gradient(circle at 50% 40%, rgba(30, 40, 18, 0.94) 0%, #0a0c08 74%);
    animation: pl-entry-fade 240ms ease-out;
  }
  .pl-entry[hidden] { display: none; }

  /* Film grain over the soil: same texture token the HUD vignette uses, so the
     entry screen feels like part of the same world rather than a web page. */
  .pl-entry::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: var(--film-grain);
    opacity: 0.55;
    mix-blend-mode: soft-light;
  }

  .pl-entry__card {
    position: relative;
    z-index: 1;
    width: min(440px, 100%);
    max-height: 100%;
    padding: clamp(20px, 4.2vw, 34px);
    border-radius: 20px;
    border: 1px solid rgba(94, 122, 53, 0.38);
    border-top-color: rgba(200, 232, 108, 0.32);
    background:
      linear-gradient(168deg, rgba(34, 38, 25, 0.97) 0%, rgba(16, 18, 12, 0.98) 52%, rgba(9, 11, 7, 0.99) 100%);
    box-shadow:
      0 28px 70px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(220, 240, 160, 0.1),
      inset 0 0 70px rgba(90, 144, 46, 0.07);
    animation: pl-entry-rise 280ms cubic-bezier(0.22, 0.9, 0.3, 1);
  }

  .pl-entry__brand { display: grid; gap: 6px; margin-bottom: 20px; }
  .pl-entry__mark { width: 40px; height: 40px; margin-bottom: 2px; filter: drop-shadow(0 4px 14px rgba(90, 144, 46, 0.35)); }
  .pl-entry__eyebrow {
    margin: 0;
    font-size: 0.68em;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--leaf-300);
  }
  .pl-entry h1 {
    margin: 0;
    font-family: "Nunito", "Inter", system-ui, sans-serif;
    font-size: clamp(27px, 23px + 1.6vw, 35px);
    font-weight: 800;
    line-height: 1.08;
    letter-spacing: -0.01em;
    color: var(--bone-50);
    text-wrap: balance;
  }
  .pl-entry h2 {
    margin: 0;
    font-family: "Nunito", "Inter", system-ui, sans-serif;
    font-size: clamp(20px, 18px + 0.9vw, 25px);
    font-weight: 700;
    line-height: 1.15;
    color: var(--bone-50);
  }
  .pl-entry__lede {
    margin: 8px 0 0;
    max-width: 34ch;
    font-size: 0.95em;
    line-height: 1.55;
    color: var(--ink-muted);
  }

  .pl-entry__rule {
    height: 1px;
    margin: 18px 0;
    background: linear-gradient(90deg, transparent, rgba(94, 122, 53, 0.48), rgba(200, 232, 108, 0.16), transparent);
  }

  .pl-entry__actions { display: grid; gap: 9px; margin-top: 18px; }

  .pl-entry button {
    appearance: none;
    width: 100%;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid transparent;
    font-family: inherit;
    font-size: 0.92em;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    color: var(--bone-100);
    background: transparent;
    transition: transform 120ms ease, filter 150ms ease, background 150ms ease, border-color 150ms ease, color 150ms ease;
  }
  .pl-entry button:active:not(:disabled) { transform: translateY(1px); }
  .pl-entry button:focus-visible { outline: 2px solid var(--leaf-300); outline-offset: 2px; }
  .pl-entry button:disabled { opacity: 0.55; cursor: progress; }

  .pl-entry .primary {
    color: #0c1607;
    background: linear-gradient(180deg, var(--leaf-400) 0%, var(--leaf-600) 100%);
    box-shadow: 0 10px 24px rgba(90, 144, 46, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.28);
  }
  .pl-entry .primary:hover:not(:disabled) { filter: brightness(1.07); }
  .pl-entry .secondary {
    color: var(--bone-100);
    background: linear-gradient(180deg, rgba(60, 58, 43, 0.5) 0%, rgba(24, 26, 18, 0.78) 100%);
    border-color: rgba(154, 149, 119, 0.3);
    box-shadow: inset 0 1px 0 rgba(247, 244, 237, 0.06);
  }
  .pl-entry .secondary:hover:not(:disabled) {
    border-color: rgba(200, 232, 108, 0.42);
    background: linear-gradient(180deg, rgba(72, 76, 50, 0.55) 0%, rgba(30, 34, 22, 0.8) 100%);
  }
  .pl-entry .ghost {
    color: var(--ink-muted);
    background: transparent;
    font-weight: 500;
  }
  .pl-entry .ghost:hover:not(:disabled) {
    color: var(--leaf-200);
    background: rgba(90, 144, 46, 0.12);
  }
  .pl-entry__link {
    padding: 6px;
    background: none;
    border: none;
    color: var(--leaf-200);
    font-size: 0.85em;
    font-weight: 500;
    text-align: center;
    text-decoration: underline;
    text-decoration-color: rgba(200, 232, 108, 0.35);
    text-underline-offset: 3px;
  }
  .pl-entry__link:hover { color: var(--sprout-200); }

  .pl-entry__field { display: grid; gap: 5px; margin-bottom: 12px; text-align: left; }
  .pl-entry__label {
    font-size: 0.7em;
    font-weight: 600;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }
  .pl-entry input {
    width: 100%;
    padding: 11px 13px;
    border-radius: 11px;
    border: 1px solid rgba(94, 122, 53, 0.32);
    background: linear-gradient(180deg, rgba(5, 6, 3, 0.92) 0%, rgba(18, 20, 14, 0.92) 100%);
    color: var(--bone-50);
    font: inherit;
    font-size: 0.95em;
    box-shadow: inset 0 2px 7px rgba(0, 0, 0, 0.5);
    transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
  }
  .pl-entry input::placeholder { color: var(--bark-300); }
  .pl-entry input:focus {
    outline: none;
    border-color: var(--leaf-400);
    background: linear-gradient(180deg, rgba(9, 13, 7, 0.96) 0%, rgba(22, 26, 16, 0.96) 100%);
    box-shadow: inset 0 2px 7px rgba(0, 0, 0, 0.5), 0 0 0 3px rgba(157, 198, 94, 0.18);
  }

  .pl-entry__error {
    display: flex;
    gap: 9px;
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(212, 85, 58, 0.45);
    border-left: 3px solid var(--ember-500);
    background: linear-gradient(180deg, rgba(92, 34, 21, 0.5) 0%, rgba(40, 16, 10, 0.5) 100%);
    color: #ffc9b4;
    font-size: 0.85em;
    line-height: 1.4;
  }
  .pl-entry__error::before {
    content: "";
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    margin-top: 5px;
    border-radius: 50%;
    background: var(--ember-400);
    box-shadow: 0 0 10px rgba(255, 140, 95, 0.6);
  }

  .pl-entry__note {
    margin: 14px 0 0;
    font-size: 0.78em;
    line-height: 1.5;
    color: var(--ink-dim);
  }

  .pl-entry__stats {
    display: grid; gap: 2px; margin: 16px 0 4px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid rgba(126, 154, 74, 0.3);
    background: rgba(34, 42, 24, 0.42); font-variant-numeric: tabular-nums;
  }
  .pl-entry__stat {
    display: flex; justify-content: space-between; gap: 12px; padding: 2px 0;
    color: var(--ink-muted);
  }
  .pl-entry__stat b { color: var(--bone-100); font-weight: 600; }
  .pl-entry__stat--cause { padding-bottom: 5px; margin-bottom: 3px;
    border-bottom: 1px solid rgba(126, 154, 74, 0.22); }
  .pl-entry__stat--cause b { color: var(--ember-400); text-transform: capitalize; }

  /* Connecting: three leaves breathing, not a generic spinner. */
  .pl-entry__pulse { display: flex; gap: 8px; margin: 20px 0 4px; }
  .pl-entry__pulse i {
    width: 9px;
    height: 9px;
    border-radius: 60% 60% 60% 0;
    background: var(--leaf-400);
    box-shadow: 0 0 12px rgba(157, 198, 94, 0.35);
    animation: pl-entry-breathe 1.4s ease-in-out infinite;
  }
  .pl-entry__pulse i:nth-child(2) { animation-delay: 160ms; background: var(--leaf-500); }
  .pl-entry__pulse i:nth-child(3) { animation-delay: 320ms; background: var(--sprout-300); }

  .pl-entry__wilt { width: 36px; height: 36px; margin-bottom: 4px; opacity: 0.9; }

  @keyframes pl-entry-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pl-entry-rise {
    from { opacity: 0; transform: translateY(12px) scale(0.994); }
    to { opacity: 1; transform: none; }
  }
  @keyframes pl-entry-breathe {
    0%, 100% { transform: scale(0.86) rotate(-6deg); opacity: 0.6; }
    50% { transform: scale(1.05) rotate(0deg); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pl-entry, .pl-entry__card { animation: none; }
    .pl-entry__pulse i { animation: none; opacity: 1; }
    .pl-entry button { transition: none; }
  }

  /* Short viewports (phone landscape, small laptop with the browser chrome):
     the card scrolls inside the overlay instead of clipping its actions. */
  @media (max-height: 620px) {
    .pl-entry { place-items: start center; }
    .pl-entry__brand { margin-bottom: 14px; }
    .pl-entry__mark { width: 32px; height: 32px; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    char === '&'
      ? '&amp;'
      : char === '<'
        ? '&lt;'
        : char === '>'
          ? '&gt;'
          : char === '"'
            ? '&quot;'
            : '&#39;',
  );
}

export class EntryScreen {
  private readonly root: HTMLDivElement;
  private readonly callbacks: EntryScreenCallbacks;

  constructor(options: EntryScreenOptions) {
    this.callbacks = options.callbacks;
    installStyles();
    this.root = document.createElement('div');
    this.root.className = 'pl-entry';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Plant Legacy');
    (options.mount ?? document.body).appendChild(this.root);

    // Escape returns to the title from a form. The overlay is modal, so the key
    // must not fall through to the game's Escape handlers underneath.
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const step = this.root.dataset.step;
      if (step !== 'sign_in' && step !== 'sign_up') return;
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onBack();
    });
  }

  /** Rebuild the overlay for the current step. Hidden once the world is live. */
  render(state: EntryFlowStateMachine): void {
    if (state.step === 'world') {
      this.root.hidden = true;
      this.root.setAttribute('aria-hidden', 'true');
      return;
    }
    this.root.hidden = false;
    this.root.removeAttribute('aria-hidden');
    this.root.dataset.step = state.step;
    this.root.innerHTML = this.markup(state);
    this.bind(state);

    // Focus the first field of a form so keyboard players can type immediately.
    if (state.step === 'sign_in' || state.step === 'sign_up') {
      this.root.querySelector<HTMLInputElement>('input')?.focus();
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private brand(heading: string, lede: string): string {
    return `
      <div class="pl-entry__brand">
        ${SPROUT_MARK}
        <p class="pl-entry__eyebrow">Plant Legacy</p>
        <h1>${heading}</h1>
        <p class="pl-entry__lede">${lede}</p>
      </div>`;
  }

  private errorBlock(state: EntryFlowStateMachine): string {
    if (!state.error) return '';
    return `<p class="pl-entry__error" role="alert">${escapeHtml(state.error)}</p>`;
  }

  private markup(state: EntryFlowStateMachine): string {
    const busy = state.busy ? ' disabled' : '';

    if (state.step === 'booting') {
      return `
        <div class="pl-entry__card">
          ${this.brand('Plant Legacy', 'Waking the soil.')}
        </div>`;
    }

    if (state.step === 'sign_in') {
      return `
        <form class="pl-entry__card" data-form="sign_in" aria-busy="${state.busy}">
          <h2>Sign in</h2>
          <p class="pl-entry__lede">Your plant waits where you left it.</p>
          <div class="pl-entry__rule"></div>
          ${this.errorBlock(state)}
          <label class="pl-entry__field">
            <span class="pl-entry__label">Username</span>
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          </label>
          <label class="pl-entry__field">
            <span class="pl-entry__label">Password</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <div class="pl-entry__actions">
            <button class="primary" type="submit"${busy}>${state.busy ? 'Signing in…' : 'Sign in'}</button>
            <button class="ghost" type="button" data-action="back">Back</button>
          </div>
          <p class="pl-entry__note">There is no password reset yet. Keep the password somewhere safe.</p>
        </form>`;
    }

    if (state.step === 'sign_up') {
      return `
        <form class="pl-entry__card" data-form="sign_up" aria-busy="${state.busy}">
          <h2>Create an account</h2>
          <p class="pl-entry__lede">An account keeps this plant, on any device.</p>
          <div class="pl-entry__rule"></div>
          ${this.errorBlock(state)}
          <label class="pl-entry__field">
            <span class="pl-entry__label">Username</span>
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3">
          </label>
          <label class="pl-entry__field">
            <span class="pl-entry__label">Display name</span>
            <input name="displayName" autocomplete="nickname" required>
          </label>
          <label class="pl-entry__field">
            <span class="pl-entry__label">Password</span>
            <input name="password" type="password" autocomplete="new-password" required minlength="8">
          </label>
          <div class="pl-entry__actions">
            <button class="primary" type="submit"${busy}>${state.busy ? 'Creating…' : 'Create account'}</button>
            <button class="ghost" type="button" data-action="back">Back</button>
          </div>
          <p class="pl-entry__note">Eight characters or more, with upper and lower case and a number.</p>
        </form>`;
    }

    if (state.step === 'connecting') {
      return `
        <div class="pl-entry__card">
          ${this.brand(
            state.isGuest ? 'Entering as a guest' : 'Opening your garden',
            state.isGuest
              ? 'A guest plant lives in this browser only.'
              : 'Restoring your plant from its last save.',
          )}
          ${this.errorBlock(state)}
          <div class="pl-entry__pulse" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="pl-entry__note">Reaching the world. This takes a moment.</p>
        </div>`;
    }

    if (state.step === 'plant_lost') {
      return `
        <div class="pl-entry__card">
          <svg class="pl-entry__wilt" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
            <path d="M32 58 C32 44 26 34 14 28 C22 42 26 50 32 58 Z" fill="#a5442a" fill-opacity=".8"/>
            <path d="M32 58 C32 46 40 36 52 32 C46 46 40 52 32 58 Z" fill="#7a3020" fill-opacity=".85"/>
            <path d="M32 58 C31 48 31 40 32 34" stroke="#efe9d8" stroke-opacity=".35" stroke-width="1.3" fill="none" stroke-linecap="round"/>
            <ellipse cx="32" cy="60" rx="8" ry="2.3" fill="#3c3a2b" fill-opacity=".55"/>
          </svg>
          <h2>Your plant is gone</h2>
          <p class="pl-entry__lede">${state.lostReason ? escapeHtml(state.lostReason) : 'It dried out, starved, or the seed never sprouted.'} The soil is still there.</p>
          ${this.errorBlock(state)}
          ${state.lostStats ? this.statsTable(state.lostStats.cause, state.lostStats.stats) : ''}
          <div class="pl-entry__actions">
            <button class="primary" type="button" data-action="reseed">Plant a new seed</button>
          </div>
        </div>`;
    }

    // title
    return `
      <div class="pl-entry__card">
        ${this.brand('Plant Legacy', 'Grow a plant that outlives you.')}
        <div class="pl-entry__rule"></div>
        ${this.errorBlock(state)}
        <div class="pl-entry__actions">
          ${state.hasSession ? '<button class="primary" type="button" data-action="continue">Continue</button>' : ''}
          <button class="${state.hasSession ? 'secondary' : 'primary'}" type="button" data-action="sign_in">Sign in</button>
          <button class="secondary" type="button" data-action="sign_up">Create account</button>
          <button class="ghost" type="button" data-action="guest">Play as a guest</button>
        </div>
        <p class="pl-entry__note">A guest plant is tied to this browser session. Sign in to keep it across devices.</p>
      </div>`;
  }

  private statsTable(cause: string, stats: PlantStatsSummary): string {
    const rows = plantStatRows(stats)
      .map(
        ([label, value]) =>
          `<div class="pl-entry__stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
      )
      .join('');
    return `
      <div class="pl-entry__stats">
        <div class="pl-entry__stat pl-entry__stat--cause"><span>Cause</span><b>${escapeHtml(cause.replace(/_/g, ' '))}</b></div>
        ${rows}
      </div>`;
  }

  private bind(state: EntryFlowStateMachine): void {
    const form = this.root.querySelector('form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (state.busy) return;
        const data = new FormData(form);
        const username = String(data.get('username') ?? '').trim();
        const password = String(data.get('password') ?? '');
        if (state.step === 'sign_up') {
          const displayName = String(data.get('displayName') ?? '').trim();
          this.callbacks.onSignUp(username, displayName, password);
        } else {
          this.callbacks.onSignIn(username, password);
        }
      });
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      button.addEventListener('click', () => {
        switch (button.dataset.action) {
          case 'continue':
            this.callbacks.onContinue();
            break;
          case 'sign_in':
            this.callbacks.onSignInForm();
            break;
          case 'sign_up':
            this.callbacks.onSignUpForm();
            break;
          case 'guest':
            this.callbacks.onGuest();
            break;
          case 'reseed':
            this.callbacks.onReseed();
            break;
          case 'back':
            this.callbacks.onBack();
            break;
        }
      });
    }
  }
}
