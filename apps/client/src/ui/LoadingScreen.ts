/**
 * The screen between pressing Play and standing in the world.
 *
 * WELCOME arrives before the first plant frame: the socket has to greet, the
 * plant meshes have to be built and their shaders compiled, and the first draw
 * of a new world is the most expensive frame the client ever runs. The title
 * used to vanish on the greeting, so the player watched a bare hillside - or a
 * stale menu - for about a second and then the plant popped in. This cover
 * stays up until the plant has actually been drawn, not until the socket says
 * hello, and it is a real screen rather than a blank hold: the ground, a seed
 * mark and one line of copy.
 *
 * It is deliberately dumb: show, hide, and a frame counter for the caller.
 */

export interface LoadingScreenOptions {
  mount: HTMLElement;
}

export interface LoadingScreenAPI {
  readonly element: HTMLElement;
  show(message?: string): void;
  hide(): void;
  readonly visible: boolean;
  destroy(): void;
}

const STYLE_ID = 'pl-loading-style';

const STYLE = `
  .pl-loading {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 18px;
    background:
      radial-gradient(120% 90% at 50% 12%, rgba(58, 74, 52, 0.96), rgba(18, 16, 12, 0.99)),
      #12100c;
    color: var(--bone-100, #f7f4ed);
    font: inherit;
    transition: opacity 260ms ease;
  }
  .pl-loading[hidden] { display: none; }
  .pl-loading--fading { opacity: 0; pointer-events: none; }
  .pl-loading__seed {
    width: 34px;
    height: 46px;
    border-radius: 50% 50% 46% 46% / 58% 58% 42% 42%;
    background: linear-gradient(160deg, #e8d6a6, #9c7f4c 62%, #6b5230);
    box-shadow: 0 0 0 1px rgba(20, 16, 10, 0.5), 0 10px 30px rgba(0, 0, 0, 0.45);
    animation: pl-loading-breathe 1900ms ease-in-out infinite;
  }
  .pl-loading__copy {
    font-size: 13px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    opacity: 0.82;
  }
  .pl-loading__bar {
    width: 168px;
    height: 3px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(247, 244, 237, 0.14);
  }
  .pl-loading__bar::after {
    content: '';
    display: block;
    width: 46%;
    height: 100%;
    border-radius: inherit;
    background: var(--leaf-200, #cfe68a);
    animation: pl-loading-sweep 1250ms ease-in-out infinite;
  }
  @keyframes pl-loading-breathe {
    0%, 100% { transform: scale(1) rotate(-2deg); }
    50% { transform: scale(1.045) rotate(2deg); }
  }
  @keyframes pl-loading-sweep {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(240%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-loading__seed, .pl-loading__bar::after { animation: none; }
  }
`;

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

export function createLoadingScreen(options: LoadingScreenOptions): LoadingScreenAPI {
  installStyles();
  const element = document.createElement('div');
  element.className = 'pl-loading';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.innerHTML =
    '<div class="pl-loading__seed" aria-hidden="true"></div>' +
    '<div class="pl-loading__bar" aria-hidden="true"></div>' +
    '<div class="pl-loading__copy">Waking your plant</div>';
  const copy = element.querySelector<HTMLElement>('.pl-loading__copy');
  options.mount.appendChild(element);
  element.hidden = true;

  let visible = false;
  let fadeTimer = 0;

  return {
    element,
    get visible() {
      return visible;
    },
    show(message) {
      if (message && copy) copy.textContent = message;
      if (visible) return;
      visible = true;
      window.clearTimeout(fadeTimer);
      element.hidden = false;
      element.classList.remove('pl-loading--fading');
    },
    hide() {
      if (!visible) return;
      visible = false;
      element.classList.add('pl-loading--fading');
      fadeTimer = window.setTimeout(() => {
        element.hidden = true;
        element.classList.remove('pl-loading--fading');
      }, 280);
    },
    destroy() {
      window.clearTimeout(fadeTimer);
      element.remove();
    },
  };
}
