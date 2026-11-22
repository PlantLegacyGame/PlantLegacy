/**
 * What the title plant sounds like when it is bent.
 *
 * Creak is not noise, it is a *stick-slip pulse train*, and the numbers here come
 * from the standard models rather than from taste:
 *
 * - Friction falls as sliding speed rises (static > kinetic). The contact sticks,
 *   force builds, it breaks away and slips, then re-sticks. Every slip is an
 *   impulse into the structure (the spring-block model in DAFx-13, "Controlling a
 *   Non Linear Friction Model for Evocative Sound Synthesis Applications").
 * - A creak's spectrum is harmonic with a fundamental that moves with speed and
 *   pressure; under load the stick-slip cycles at a structural mode, so the slip
 *   rate *is* the pitch (hundreds of Hz up to a few kHz).
 * - Andy Farnell's "Designing Sound" door (ch. 32) is the reference graph: a
 *   force-smoothed generator that fires at `linlin(force, 0.1, 1, 1, 1/0.003)` -
 *   1 Hz to ~333 Hz - with nothing below 0.1 (static friction), each slip's
 *   amplitude the square root of the force that built up and its decay the square
 *   root of that amplitude; the events excite a wooden body of parallel band-passes
 *   plus short panel delays above 125 Hz, with the dry impulse mixed at 20%.
 *
 * What this file deliberately does *not* have, after a second look at the graph:
 *
 * - No continuous strain oscillator. A sustained saw through the wood modes read
 *   as a motor under the creak; the slip train already carries the pitch, and the
 *   release groan carries the unloading. Removed with its LFO, tremolo and depth
 *   node.
 * - No third panel tap (0.22 gain, inaudible next to the other two), no 690 Hz
 *   body mode (the 3 kHz squeak band supplies the brightness), and no dedicated
 *   noise tail on the groan - the release already fires a spreading slip tail.
 * - No force accumulator. One `forceNow()` decays the pull with time, read when a
 *   slip is scheduled, instead of a mutable value nudged on every pointermove and
 *   again on every timer tick.
 *
 * A green stem is not a door panel, so the body is lighter and more damped: four
 * modes rather than six, shorter delay taps, and a quieter 3 kHz edge. The slip
 * generator is the door's, driven by the drag: force follows how fast the stem is
 * being pulled, with depth as a smaller term, and a hold sits at the static
 * threshold - a jammed stem is silent, which is also what keeps a menu quiet.
 *
 * The preference lives in this module so a Settings toggle reaches every instance:
 * instances hold a master gain that is muted, and the pump stops scheduling.
 */

import { MAX_BEND_DEG, type PlantPart } from './plantReaction.ts';

export interface PlantSound {
  /** A bend has begun: the plant is being pulled. */
  begin(): void;
  /** The current bend, in degrees, positive right. */
  bend(degrees: number): void;
  /** The plant was let go from this angle. */
  release(degrees: number): void;
  /** A part was touched; a leaf rustles, the stem knocks. */
  tap(part: PlantPart): void;
  dispose(): void;
}

/** Static friction: below this force nothing slips at all. Farnell's 0.1. */
export const STATIC_FORCE = 0.1;
/** Slip rate at full force, Hz. The door's 1/0.003 is 333; a stem is softer. */
export const MAX_SLIP_HZ = 240;
/**
 * Drag speed that counts as a full-force pull, degrees per second.
 *
 * A full bend is half the plant's width, so a deliberate drag of about a width a
 * second is 300 deg/s; a yank is several times that. Below roughly 30 deg/s the
 * contact stays jammed, which is the slow drag that should be silent.
 */
export const FULL_FORCE_DEG_PER_S = 300;
/** How long a pull stays "felt" after the last movement, ms. */
const PULL_MEMORY_MS = 110;
/** How fast the pull bleeds away after that, ms (exponential time constant). */
const PULL_DECAY_MS = 90;

/**
 * How hard the stem is being worked, 0..1.
 *
 * Speed dominates: a stem pulled slowly creaks slowly however far it is bent.
 * Depth is a small addition because a deeply bent stem is under more strain per
 * degree, but on its own it only reaches the static threshold.
 */
export function creakForce(degreesPerSecond: number, bendDeg: number): number {
  const speed = Number.isFinite(degreesPerSecond) ? Math.abs(degreesPerSecond) : 0;
  const depth = Number.isFinite(bendDeg) ? Math.abs(bendDeg) / MAX_BEND_DEG : 0;
  const worked = 0.95 * Math.min(1, speed / FULL_FORCE_DEG_PER_S) + 0.1 * Math.min(1, depth);
  return Math.max(0, Math.min(1, worked));
}

/**
 * Slip events per second for a force, and zero below the static threshold.
 *
 * Straight from Farnell's mapping, compressed to this module's softer ceiling.
 * Because the slip rate is the pitch, this is also the creak's fundamental: it
 * rises as the drag speeds up, which is the behaviour the DAFx analysis reports.
 */
export function slipRateHz(force: number): number {
  if (!(force > STATIC_FORCE)) return 0;
  const t = (Math.min(1, force) - STATIC_FORCE) / (1 - STATIC_FORCE);
  return 1 + t ** 1.35 * (MAX_SLIP_HZ - 1);
}

/** One slip's gain: the square root of the force that built up before it broke. */
export function slipAmplitude(force: number): number {
  const f = Math.max(0, Math.min(1, Number.isFinite(force) ? force : 0));
  return Math.sqrt(f);
}

/** One slip's decay, seconds: the square root of its amplitude. 3-13 ms. */
export function slipDecaySeconds(force: number): number {
  return 0.003 + 0.01 * Math.sqrt(slipAmplitude(force));
}

/** Wooden body modes of a stem: few, high, damped. */
const WOOD_MODES: ReadonlyArray<{ hz: number; q: number; gain: number }> = [
  { hz: 140, q: 1.6, gain: 1 },
  { hz: 215, q: 1.9, gain: 0.8 },
  { hz: 320, q: 2.2, gain: 0.62 },
  { hz: 480, q: 2.6, gain: 0.46 },
];

/** Short panel delays: a thin rod's body diffusion, not a door's 4-16 ms. */
const PANEL_TAPS_S: ReadonlyArray<number> = [0.0031, 0.0046];

/** Where a stem squeaks, from the 2-5 kHz band wooden creaks are reported in. */
const SQUEAK_HZ = 3000;

/** Every scheduled slip lands within this window of the audio clock. */
const LOOKAHEAD_S = 0.12;
/** How often the scheduler tops that window up. */
const PUMP_MS = 35;

// ---------------------------------------------------------------- preference

const STORAGE_KEY = 'pl-plant-sound';

function readStoredPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readStoredPreference();
/** Live instances listen for the toggle, so a switch silences a bend already held. */
const instances = new Set<() => void>();

/** Whether the plant's creaks, knocks and rustles are allowed to play. */
export function isPlantSoundEnabled(): boolean {
  return enabled;
}

/** Turn the plant's sound on or off, for this session and the next one. */
export function setPlantSoundEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  try {
    if (next) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    // No storage: the choice still stands for this session.
  }
  for (const apply of instances) apply();
}

// -------------------------------------------------------------------- engine

type AudioContextCtor = typeof AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  // The project's DOM lib does not declare AudioContext on Window, and Safari
  // still spells it webkit-prefixed, so the lookup is typed rather than assumed.
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function createPlantSound(): PlantSound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  /** Everything percussive goes in here; the body shapes it once, not per slip. */
  let bodyIn: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let disposed = false;

  let running = false;
  let lastAngle = 0;
  let lastBendMs = 0;
  /** The pull in degrees/second as of the last pointermove. */
  let speedDegPerS = 0;
  /** The bend the pull was measured at. */
  let bendDeg = 0;
  /** Next slip, on the audio clock. */
  let nextSlipAt = 0;
  let pump: ReturnType<typeof setTimeout> | null = null;

  const audible = (): boolean =>
    enabled && !disposed && typeof document !== 'undefined' && !document.hidden;

  const applyGain = (): void => {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(enabled ? 0.62 : 0, ctx.currentTime, 0.02);
  };
  instances.add(applyGain);

  /**
   * The pull as it is right now: the last measured force, held briefly, then
   * decayed. Reading it here (rather than storing a decayed copy) is what lets the
   * bend state be two numbers and a timestamp.
   */
  const forceNow = (nowMs: number): number => {
    const elapsed = nowMs - lastBendMs;
    if (elapsed <= PULL_MEMORY_MS) return creakForce(speedDegPerS, bendDeg);
    const decayed =
      creakForce(speedDegPerS, bendDeg) * Math.exp(-(elapsed - PULL_MEMORY_MS) / PULL_DECAY_MS);
    return decayed < STATIC_FORCE ? 0 : decayed;
  };

  const ensure = (): AudioContext | null => {
    if (disposed) return null;
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    const Ctor = contextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }

    master = ctx.createGain();
    // A mascot on a menu, not an event: the graph sits under conversation.
    master.gain.value = 0.62;
    master.connect(ctx.destination);

    bodyIn = ctx.createGain();
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    // A wooden body is a set of resonances: each mode is a parallel band-pass,
    // mixed with a little of the dry impulse the way the reference graph does.
    for (const mode of WOOD_MODES) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = mode.hz;
      band.Q.value = mode.q;
      const gain = ctx.createGain();
      gain.gain.value = mode.gain;
      bodyIn.connect(band).connect(gain).connect(bus);
    }
    const dry = ctx.createGain();
    dry.gain.value = 0.2;
    bodyIn.connect(dry).connect(bus);

    // The body's own diffusion: two short delays above 125 Hz. This is what stops
    // the modes reading as four sine tones.
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 125;
    bus.connect(highpass).connect(master);
    for (const tap of PANEL_TAPS_S) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = tap;
      const gain = ctx.createGain();
      gain.gain.value = 0.22;
      bus.connect(delay).connect(gain).connect(master);
    }

    // The squeak: the 2-5 kHz edge of a wooden creak, kept quiet for green wood.
    const squeak = ctx.createBiquadFilter();
    squeak.type = 'bandpass';
    squeak.frequency.value = SQUEAK_HZ;
    squeak.Q.value = 1.1;
    const squeakGain = ctx.createGain();
    squeakGain.gain.value = 0.17;
    bodyIn.connect(squeak).connect(squeakGain).connect(master);

    // One buffer of smoothed noise, reused by every slip and every rustle.
    const frames = Math.max(1, Math.round(ctx.sampleRate * 1.2));
    noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      previous = previous * 0.6 + (Math.random() * 2 - 1) * 0.4;
      data[i] = previous;
    }

    if (ctx.state === 'suspended') void ctx.resume();
    applyGain();
    return ctx;
  };

  /** One slip: a very short excitation into the body. */
  const slip = (at: number, atForce: number): void => {
    const c = ctx;
    if (!c || !noise || !bodyIn) return;
    const amplitude = 0.055 * slipAmplitude(atForce) * (0.7 + Math.random() * 0.6);
    const decay = slipDecaySeconds(atForce);
    const src = c.createBufferSource();
    src.buffer = noise;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(amplitude, at + 0.0008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(gain).connect(bodyIn);
    src.start(at, Math.random() * 0.8, decay + 0.02);
  };

  /** Top up the slip schedule a little ahead of the audio clock. */
  const schedule = (): void => {
    pump = null;
    const c = ctx;
    if (!c || !running) return;
    if (!audible()) {
      pump = setTimeout(schedule, 120);
      return;
    }
    const now = c.currentTime;
    const horizon = now + LOOKAHEAD_S;
    let at = Math.max(nextSlipAt, now + 0.005);
    // At least one evaluation per horizon keeps the deadline moving when silent.
    while (at < horizon) {
      const force = forceNow(performance.now());
      const rate = slipRateHz(force);
      if (rate <= 0) {
        at = horizon;
        break;
      }
      slip(at, force);
      // A real contact never fires perfectly regularly.
      at += 1 / (rate * (0.55 + Math.random() * 1.5));
    }
    nextSlipAt = at;
    pump = setTimeout(schedule, PUMP_MS);
  };

  const stop = (): void => {
    running = false;
    if (pump !== null) {
      clearTimeout(pump);
      pump = null;
    }
  };

  /** A wooden knock: the body answering a tap, three modes, no pitch sweep. */
  const knock = (strength: number): void => {
    const c = ensure();
    if (!c || !bodyIn) return;
    const t = c.currentTime;
    const amp = 0.03 + 0.06 * Math.max(0, Math.min(1, strength));
    for (const mode of WOOD_MODES.slice(0, 3)) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(mode.hz * (0.97 + Math.random() * 0.06), t);
      const gain = c.createGain();
      const decay = 0.12 / Math.sqrt(mode.q);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(amp * mode.gain, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(gain).connect(bodyIn);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }
  };

  /** The spring returning: a falling harmonic groan, then the body settles. */
  const groan = (strength: number): void => {
    const c = ensure();
    if (!c || !bodyIn) return;
    const t = c.currentTime;
    const duration = 0.38 + 0.34 * strength;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120 + 260 * strength, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + duration);

    // A creak's harmonics are amplitude-modulated by the slip rate; as the stem
    // unloads that rate falls, which is what makes it read as a slowing groan.
    const tremolo = c.createGain();
    tremolo.gain.value = 0.55;
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(28 + 120 * strength, t);
    lfo.frequency.exponentialRampToValueAtTime(9, t + duration);
    const depth = c.createGain();
    depth.gain.value = 0.45;
    lfo.connect(depth).connect(tremolo.gain);

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(420, t + duration);
    filter.Q.value = 3;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.02 + 0.05 * strength, t + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(filter).connect(tremolo).connect(gain).connect(bodyIn);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + duration + 0.03);
    lfo.stop(t + duration + 0.03);
  };

  /** A tap on a part: leaves rustle, the stem and roots knock on their body. */
  const tapSound = (part: PlantPart): void => {
    const c = ensure();
    if (!c || !noise || !master) return;
    if (part !== 'leaf' && part !== 'bud') {
      knock(part === 'root' ? 0.45 : 0.8);
      return;
    }
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = (part === 'bud' ? 2100 : 3000) * (0.9 + Math.random() * 0.25);
    band.Q.value = 1.1;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(part === 'bud' ? 0.035 : 0.05, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    src.connect(band).connect(gain).connect(master);
    src.start(t, Math.random() * 0.6, 0.13);
  };

  return {
    begin(): void {
      if (!audible()) return;
      ensure();
      running = true;
      speedDegPerS = 0;
      bendDeg = 0;
      lastBendMs = 0;
      nextSlipAt = 0;
      if (pump === null) schedule();
    },
    bend(degrees: number): void {
      if (!Number.isFinite(degrees)) return;
      const now = performance.now();
      const dt = lastBendMs === 0 ? 16 : Math.max(1, now - lastBendMs);
      speedDegPerS = Math.abs(degrees - lastAngle) / (dt / 1000);
      lastAngle = degrees;
      lastBendMs = now;
      bendDeg = degrees;
    },
    release(degrees: number): void {
      const from = Math.abs(Number.isFinite(degrees) ? degrees : 0) / MAX_BEND_DEG;
      stop();
      speedDegPerS = 0;
      bendDeg = 0;
      if (!audible()) return;
      ensure();
      if (!(from > 0.06)) return;
      groan(Math.min(1, from));
      // The last slips as it comes to rest, spreading out.
      const c = ctx;
      if (c) {
        const startAt = c.currentTime + 0.01;
        for (let at = 0; at < 0.3; at += 0.02 + at * 0.9) {
          slip(startAt + at, Math.max(STATIC_FORCE + 0.02, from * (1 - at / 0.34)));
        }
      }
      knock(from * 0.9);
    },
    tap(part: PlantPart): void {
      if (!audible()) return;
      tapSound(part);
    },
    dispose(): void {
      disposed = true;
      stop();
      instances.delete(applyGain);
      const closing = ctx;
      ctx = null;
      master = null;
      bodyIn = null;
      noise = null;
      if (closing && typeof closing.close === 'function') void closing.close();
    },
  };
}
