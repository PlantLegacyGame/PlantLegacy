/**
 * One bot: connects over the real WebSocket, plays a plant, and writes down
 * anything the server does to it that growing a plant should not do.
 *
 * No test doubles and no shortcuts: the bot speaks the same protocol the
 * browser client speaks, so a bug it finds is a bug a player can hit.
 */
import { MESSAGE_TYPE, PROTOCOL_VERSION } from '@plant-legacy/shared/protocol';
import { directionFor, GROWTH_PLAN, isRootOrgan } from './policy.ts';
import { Findings } from './report.ts';

/** Minimal structural view of Node's built-in WebSocket. */
type MessageEventLike = { data: unknown };
type CloseEventLike = { code: number; reason: string };
type ErrorEventLike = { message?: string };

interface BotSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEventLike) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEventLike) => void): void;
}

type WebSocketConstructor = new (url: string) => BotSocket;

function createSocket(url: string): BotSocket {
  const ctor = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!ctor) throw new Error('This Node has no global WebSocket (need Node 22+).');
  return new ctor(url);
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface GrowthOptionView {
  type: string;
  label?: string;
  energyCost: number;
  biomassGain: number;
  expectedSeconds: number;
  available: boolean;
  reason?: string;
}

export interface NodeView {
  id: string;
  type: string;
  layer: string;
  parentId: string | null;
  growthProgress: number;
  x: number;
  y: number;
  z: number;
}

interface OptionCacheEntry {
  at: number;
  nodeType: string;
  isSeed: boolean;
  options: GrowthOptionView[];
  conditions?: Json;
}

export interface BotOptions {
  name: string;
  url: string;
  /** Milliseconds to keep playing before the bot stops itself. */
  durationMs: number;
  /** Milliseconds between decision attempts. */
  tickMs?: number;
  /** Extra socket messages, for debugging a session. */
  verbose?: boolean;
}

/** Damage sources that legitimately exist in the world. */
const LEGITIMATE_DAMAGE_SOURCES = new Set(['weather', 'herbivore', 'tool', 'terrain']);
const STORM_STATES = new Set(['thunderstorm_active', 'thunderstorm_telegraph']);
/** A growth and a damage hit this close together are treated as related. */
const GROWTH_DAMAGE_WINDOW_MS = 15_000;
/** No accepted growth for this long, with options on offer, is a stall. */
const STALL_MS = 60_000;
const OPTION_TTL_MS = 1_500;
const SYNC_INTERVAL_MS = 2_500;

export class Bot {
  readonly findings: Findings;

  private socket: BotSocket | null = null;
  private stopAt = 0;
  private loop: ReturnType<typeof setInterval> | null = null;

  private playerId: string | null = null;
  private plantId: string | null = null;
  private plantAlive = true;

  private readonly nodes = new Map<string, NodeView>();
  private readonly options = new Map<string, OptionCacheEntry>();
  private readonly planCursor = { index: 0 };
  private busyUntil = 0;

  private tick = 0;
  private weather = 'clear';
  private lastSyncAt = 0;
  private lastGrowthAt = 0;
  private lastGrowthType = '';
  private acceptedGrowths = 0;
  private rejected = 0;
  private lastRejectReason = '';
  private repeatedRejectReason = '';
  private repeatedRejectCount = 0;
  private readonly mutationsSeen = new Map<
    string,
    { name: string; signature: number; target: string }
  >();
  /** How many parts have been grown from each parent, so one tip is not spammed. */
  private readonly grownFrom = new Map<string, number>();
  private lastEnergy = Number.NaN;
  /** Weather hits and uproots are world hazards, not growth bugs; remember them. */
  private sawWeatherDamage = false;
  private uprootReported = false;

  private readonly optionsIn: BotOptions;

  constructor(optionsIn: BotOptions) {
    this.optionsIn = optionsIn;
    this.findings = new Findings(optionsIn.name);
  }

  get name(): string {
    return this.optionsIn.name;
  }

  /** Plays until the duration elapses, the plant dies, or the socket closes. */
  async play(): Promise<void> {
    const { url, durationMs, tickMs = 250 } = this.optionsIn;
    this.stopAt = Date.now() + durationMs;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        this.stop();
        resolve();
      };

      const socket = createSocket(url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.log('connected');
        this.send(MESSAGE_TYPE.HELLO, { clientVersion: PROTOCOL_VERSION });
      });
      socket.addEventListener('message', (event) => this.onMessage(event.data));
      socket.addEventListener('error', (event) => {
        this.findings.error('socket-error', `socket error: ${event.message ?? 'unknown'}`);
      });
      socket.addEventListener('close', (event) => {
        this.log(`closed code=${event.code} reason=${event.reason || 'none'}`);
        done();
      });

      this.loop = setInterval(() => {
        if (Date.now() >= this.stopAt || !this.plantAlive) {
          done();
          return;
        }
        this.decide();
      }, tickMs);

      // Hard stop, in case the socket never opens.
      setTimeout(done, durationMs + 15_000);
    });

    this.summarise();
  }

  private stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    try {
      this.socket?.close(1000, 'bot finished');
    } catch {
      // already closed
    }
  }

  // ---- wire ------------------------------------------------------------

  private send(type: number, payload: Json): void {
    const socket = this.socket;
    if (socket?.readyState !== 1) return;
    socket.send(JSON.stringify({ type, payload }));
  }

  private requestSync(): void {
    this.lastSyncAt = Date.now();
    this.send(MESSAGE_TYPE.PLANT_SYNC_REQUEST, {});
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.findings.warn('bad-json', 'server sent a frame that is not JSON');
      return;
    }
    if (!isRecord(parsed)) return;
    const type = num(parsed.type, -1);
    const payload = isRecord(parsed.payload) ? parsed.payload : {};

    switch (type) {
      case MESSAGE_TYPE.WELCOME:
        this.onWelcome(payload);
        break;
      case MESSAGE_TYPE.STATE:
      case MESSAGE_TYPE.KEYFRAME:
        this.tick = num(payload.tick, this.tick);
        break;
      case MESSAGE_TYPE.PLANT_SYNC:
        this.onPlantSync(payload);
        break;
      case MESSAGE_TYPE.GROWTH_OPTIONS_RESULT:
        this.onGrowthOptions(payload);
        break;
      case MESSAGE_TYPE.GROWTH_EVENT:
        this.onGrowthEvent(payload);
        break;
      case MESSAGE_TYPE.REJECT:
        this.onReject(payload);
        break;
      case MESSAGE_TYPE.PLANT_DAMAGE:
        this.onDamage(payload);
        break;
      case MESSAGE_TYPE.PLANT_UPROOT:
        this.onUproot(payload);
        break;
      case MESSAGE_TYPE.PLANT_REMOVED:
        this.onRemoved(payload);
        break;
      case MESSAGE_TYPE.WEATHER_UPDATE:
        this.weather = str(payload.weatherState) || this.weather;
        break;
      case MESSAGE_TYPE.MUTATION_STATE:
        this.onMutations(payload);
        break;
      case MESSAGE_TYPE.ERROR:
        this.findings.error('server-error', `ERROR ${str(payload.code)}: ${str(payload.message)}`, {
          payload,
        });
        break;
      default:
        break;
    }
  }

  // ---- session ---------------------------------------------------------

  private onWelcome(payload: Json): void {
    this.playerId = str(payload.playerId) || null;
    this.plantId = str(payload.plantId) || null;
    this.tick = num(payload.tick, 0);
    if (!this.plantId) {
      this.findings.error('no-plant', 'WELCOME carried no plantId; cannot play');
      this.plantAlive = false;
      return;
    }
    const root = isRecord(payload.rootNode) ? payload.rootNode : null;
    if (root && str(root.id)) {
      this.nodes.set(str(root.id), this.toNodeView(root));
    }
    for (const node of arr(payload.nodes)) {
      if (isRecord(node) && str(node.id)) this.nodes.set(str(node.id), this.toNodeView(node));
    }
    this.log(`plant ${this.plantId} with ${this.nodes.size} node(s)`);
    this.requestSync();
  }

  private toNodeView(node: Json): NodeView {
    return {
      id: str(node.id),
      type: str(node.type) || 'seed',
      layer: str(node.layer),
      parentId: typeof node.parentId === 'string' ? node.parentId : null,
      growthProgress: num(node.growthProgress, 1),
      x: num(node.x),
      y: num(node.y),
      z: num(node.z),
    };
  }

  private onPlantSync(payload: Json): void {
    const plants = arr(payload.plants);
    const own = plants.find(
      (plant): plant is Json => isRecord(plant) && str(plant.id) === this.plantId,
    );
    if (!own) return;
    const previous = this.nodes.size;
    this.nodes.clear();
    for (const node of arr(own.nodes)) {
      if (!isRecord(node) || !str(node.id)) continue;
      this.nodes.set(str(node.id), this.toNodeView(node));
      const biomass = num(node.biomass, Number.NaN);
      if (Number.isFinite(biomass) && biomass < 0) {
        this.findings.error('negative-mass', 'a node reports negative biomass', { node });
      }
    }
    const energy = num(own.totalEnergy, Number.NaN);
    if (Number.isFinite(energy)) {
      this.lastEnergy = energy;
      if (energy < 0) {
        this.findings.error('negative-energy', 'the plant reports negative stored energy', {
          totalEnergy: energy,
          nodes: this.nodes.size,
        });
      }
    }
    if (this.nodes.size < previous) {
      this.log(
        `sync shrank the mirror ${previous} -> ${this.nodes.size} [${[...this.nodes.values()]
          .map((node) => node.type)
          .join(', ')}]`,
      );
    } else {
      this.log(
        `sync ${this.nodes.size} node(s) [${[...this.nodes.values()]
          .map((node) => node.type)
          .join(', ')}]`,
      );
    }
    if (isRecord(own)) {
      this.log(
        `  biomass=${num(own.totalBiomass, -1).toFixed(2)} energy=${num(
          own.totalEnergy,
          -1,
        ).toFixed(2)} upkeep=${num(own.totalUpkeep, -1).toFixed(2)}`,
      );
    }
  }

  private onGrowthOptions(payload: Json): void {
    const nodeId = str(payload.nodeId);
    if (!nodeId) return;
    const options: GrowthOptionView[] = arr(payload.options)
      .filter(isRecord)
      .map((option) => ({
        type: str(option.type),
        label: str(option.label),
        energyCost: num(option.energyCost),
        biomassGain: num(option.biomassGain),
        expectedSeconds: num(option.expectedSeconds, 5),
        available: option.available === true,
        reason: typeof option.reason === 'string' ? option.reason : undefined,
      }));
    this.options.set(nodeId, {
      at: Date.now(),
      nodeType: str(payload.nodeType) || 'seed',
      isSeed: payload.isSeed === true,
      options,
      conditions: isRecord(payload.conditions) ? payload.conditions : undefined,
    });
  }

  private onGrowthEvent(payload: Json): void {
    this.acceptedGrowths += 1;
    this.lastGrowthAt = Date.now();
    this.lastRejectReason = '';
    this.repeatedRejectReason = '';
    this.repeatedRejectCount = 0;

    const added = arr(payload.newNodes);
    if (payload.newNode && isRecord(payload.newNode)) added.push(payload.newNode);
    for (const node of added) {
      if (isRecord(node) && str(node.id)) this.nodes.set(str(node.id), this.toNodeView(node));
    }
    const parent = payload.updatedParentNode;
    if (isRecord(parent) && str(parent.id)) {
      this.nodes.set(str(parent.id), this.toNodeView(parent));
    }

    const energy = num(payload.totalEnergy, Number.NaN);
    if (Number.isFinite(energy)) {
      if (energy < 0) {
        this.findings.error('negative-energy', 'growth left the plant with negative energy', {
          totalEnergy: energy,
          nodeType: this.lastGrowthType,
        });
      }
      this.lastEnergy = energy;
    }
    // Growth that finished instantly would be suspicious; near-zero time is
    // fine (the server owns the clock), so this only reports absurd values.
    const biomass = num(payload.totalBiomass, -1);
    if (biomass === 0 && this.nodes.size > 1) {
      this.findings.error('zero-biomass', 'plant has nodes but no biomass', {
        nodes: this.nodes.size,
      });
    }
  }

  private onReject(payload: Json): void {
    this.rejected += 1;
    const reason = str(payload.reason) || 'unknown';
    this.lastRejectReason = reason;
    this.log(`refused: ${reason}`);
    if (reason === this.repeatedRejectReason) {
      this.repeatedRejectCount += 1;
    } else {
      this.repeatedRejectReason = reason;
      this.repeatedRejectCount = 1;
    }
    // An energy or storage refusal is the plant being poor, not a defect: the
    // quote was right when it was issued and the plant spent its energy since.
    // Only a refusal with no resource explanation is worth reporting.
    const resourceReason =
      reason.includes('insufficient') || reason.includes('energy') || reason.includes('stor');
    if (this.repeatedRejectCount === 6 && !resourceReason) {
      this.findings.warn('reject-loop', `the same intent was refused 6 times: ${reason}`, {
        nodeType: this.lastGrowthType,
        reason,
      });
    }
    // The menu that produced this intent was wrong about the plant's state, so
    // throw it away instead of retrying the same numbers. A cooldown is normal
    // pacing; anything else means the quote and the charge disagree.
    this.options.clear();
    this.busyUntil = Date.now() + (reason === 'growth_on_cooldown' ? 700 : 1_200);
  }

  private onDamage(payload: Json): void {
    const source = str(payload.source) || 'unknown';
    const sinceGrowthMs =
      this.lastGrowthAt > 0 ? Date.now() - this.lastGrowthAt : Number.POSITIVE_INFINITY;
    const context = {
      source,
      nodeId: str(payload.nodeId),
      destroyed: arr(payload.destroyedNodeIds).length,
      amount: num(payload.amount),
      totalBiomass: num(payload.totalBiomass),
      damageHp: num(payload.damageHp),
      structuralThreshold: num(payload.structuralThreshold),
      weather: this.weather,
      sinceGrowthMs: Number.isFinite(sinceGrowthMs) ? Math.round(sinceGrowthMs) : null,
      nodeCount: this.nodes.size,
    };

    if (source === 'weather') this.sawWeatherDamage = true;

    if (!LEGITIMATE_DAMAGE_SOURCES.has(source)) {
      this.findings.error(
        'damage-without-source',
        `plant took ${num(payload.amount).toFixed(2)} damage from an unknown source "${source}"`,
        context,
      );
    }
    // The reported bug: a plant loses tissue or a root just for growing. If a
    // hit lands shortly after a growth and the sky is not a storm, nothing in
    // the world explains it.
    if (sinceGrowthMs <= GROWTH_DAMAGE_WINDOW_MS && !STORM_STATES.has(this.weather)) {
      this.findings.error(
        'damage-while-growing',
        `took ${num(payload.amount).toFixed(2)} ${source} damage ${
          Number.isFinite(sinceGrowthMs) ? `${Math.round(sinceGrowthMs / 1000)}s` : 'moments'
        } after growing ${this.lastGrowthType} under "${this.weather}" skies`,
        context,
      );
    }
  }

  private onUproot(payload: Json): void {
    const cause = str(payload.cause) || 'unknown';
    const phase = str(payload.phase);
    // A streaming transform is sent every tick while a plant tumbles. Only the
    // moment it is torn free is a reportable event.
    if (phase !== 'uprooted' || this.uprootReported) return;
    this.uprootReported = true;
    const sinceGrowthMs =
      this.lastGrowthAt > 0 ? Date.now() - this.lastGrowthAt : Number.POSITIVE_INFINITY;
    const context = { cause, phase, sinceGrowthMs, weather: this.weather };
    if (sinceGrowthMs <= GROWTH_DAMAGE_WINDOW_MS && !STORM_STATES.has(this.weather)) {
      this.findings.error(
        'uproot-while-growing',
        `plant was uprooted (${cause}) right after growing ${this.lastGrowthType}`,
        context,
      );
    } else {
      this.findings.warn('uproot', `uprooted by ${cause}`, context);
    }
  }

  private onRemoved(payload: Json): void {
    const cause = str(payload.cause) || 'unknown';
    const source = str(payload.source);
    this.plantAlive = false;
    const context = {
      cause,
      source,
      nodes: this.nodes.size,
      growths: this.acceptedGrowths,
      weather: this.weather,
      energy: Number.isFinite(this.lastEnergy) ? this.lastEnergy : null,
    };
    if (cause === 'mutation_upkeep') {
      // The bill is only the whole story when nothing else hurt the plant: after
      // a storm that stripped its canopy, the mutation bill is the last straw,
      // not a standalone killer.
      const detail = `plant died of mutation upkeep after ${this.acceptedGrowths} growths (${this.nodes.size} nodes)`;
      if (this.sawWeatherDamage) this.findings.warn('mutation-upkeep-death', detail, context);
      else this.findings.error('mutation-upkeep-death', detail, context);
    } else if (cause === 'starvation' || cause === 'damage') {
      this.findings.error('death-while-growing', `plant died: ${cause} ${source}`, context);
    } else {
      this.findings.warn('plant-removed', `plant removed: ${cause}`, context);
    }
  }

  private onMutations(payload: Json): void {
    const seenSignatures = new Map<number, string>();
    for (const entry of arr(payload.mutations)) {
      if (!isRecord(entry)) continue;
      const id = str(entry.id);
      const signature = num(entry.visualSignature, 0);
      const target = str(entry.visualTarget) || 'none';
      this.mutationsSeen.set(id, { name: str(entry.name) || id, signature, target });
      if (signature > 0 && target === 'none') {
        this.findings.info(
          'mutation-invisible',
          `"${str(entry.name) || id}" carries visual signature ${signature} but paints no organ (visual_target: none)`,
          { id, signature, target },
        );
      }
      const other = seenSignatures.get(signature);
      if (signature > 0 && other && other !== id) {
        this.findings.info(
          'mutation-look-collision',
          `"${str(entry.name) || id}" and "${other}" share visual signature ${signature}`,
          { signature, ids: [id, other] },
        );
      }
      if (signature > 0) seenSignatures.set(signature, str(entry.name) || id);
    }
  }

  // ---- decisions -------------------------------------------------------

  private decide(): void {
    if (!this.plantId || !this.plantAlive) return;
    const now = Date.now();
    if (now < this.busyUntil) return;

    if (now - this.lastSyncAt > SYNC_INTERVAL_MS) this.requestSync();

    const choice = this.chooseGrowth(now);
    if (choice) {
      this.grow(choice.nodeId, choice.type, choice.expectedSeconds);
      return;
    }

    // Nothing was affordable or cached: refresh the menu for a few likely
    // parents so the next pass has something to choose from.
    const stale = [...this.nodes.values()]
      .sort((a, b) => {
        if (a.type === 'seed' && b.type !== 'seed') return -1;
        if (b.type === 'seed' && a.type !== 'seed') return 1;
        return b.growthProgress - a.growthProgress;
      })
      .slice(0, 4);
    for (const node of stale) {
      const cached = this.options.get(node.id);
      if (!cached || now - cached.at > OPTION_TTL_MS) {
        this.send(MESSAGE_TYPE.GROWTH_OPTIONS_REQUEST, {
          plantId: this.plantId,
          nodeId: node.id,
        });
      }
    }

    if (this.lastGrowthAt > 0 && now - this.lastGrowthAt > STALL_MS) {
      // A stall is only a defect when something was both available *and*
      // affordable: a plant that cannot pay for growth is starved, which is the
      // game working.
      const affordable = (option: GrowthOptionView): boolean =>
        !Number.isFinite(this.lastEnergy) || option.energyCost <= this.lastEnergy;
      const anyAvailable = [...this.options.values()].some((entry) =>
        entry.options.some((option) => option.available && affordable(option)),
      );
      if (anyAvailable) {
        this.findings.warn(
          'stall',
          `no growth accepted for ${Math.round((now - this.lastGrowthAt) / 1000)}s while affordable options were offered`,
          { lastReject: this.lastRejectReason, nodes: this.nodes.size },
        );
      }
      // Move the clock either way: one report per quiet minute, not per tick.
      this.lastGrowthAt = now;
    }
  }

  private chooseGrowth(now: number): (GrowthOptionView & { nodeId: string }) | null {
    const plan = GROWTH_PLAN;
    // An organ the plant cannot pay for is not a choice; the server refuses it.
    const affordable = (option: GrowthOptionView): boolean =>
      !Number.isFinite(this.lastEnergy) || option.energyCost <= this.lastEnergy;
    for (let offset = 0; offset < plan.length; offset += 1) {
      const wanted = plan[(this.planCursor.index + offset) % plan.length];
      for (const node of this.nodes.values()) {
        if ((this.grownFrom.get(node.id) ?? 0) >= 6) continue;
        const entry = this.options.get(node.id);
        if (!entry || now - entry.at > OPTION_TTL_MS) continue;
        const option = entry.options.find((candidate) => candidate.type === wanted);
        if (!option?.available || !affordable(option)) continue;
        this.planCursor.index = (this.planCursor.index + offset + 1) % plan.length;
        return { ...option, nodeId: node.id };
      }
    }
    return null;
  }

  private grow(nodeId: string, nodeType: string, expectedSeconds: number): void {
    if (!this.plantId) return;
    this.lastGrowthType = nodeType;
    this.busyUntil = Date.now() + Math.max(400, expectedSeconds * 1000 * 1.05);
    this.send(MESSAGE_TYPE.GROWTH_INTENT, {
      intent: {
        plantId: this.plantId,
        nodeId,
        direction: directionFor(nodeType, this.acceptedGrowths),
        nodeType,
        tick: this.tick,
      },
    });
    this.options.delete(nodeId);
    this.grownFrom.set(nodeId, (this.grownFrom.get(nodeId) ?? 0) + 1);
    this.log(`grow ${nodeType} from ${nodeId} (roots: ${isRootOrgan(nodeType)})`);
  }

  // ---- output ----------------------------------------------------------

  /** What this bot did, for the run report. */
  snapshot(): {
    playerId: string | null;
    plantId: string | null;
    growths: number;
    nodes: number;
    rejects: number;
    alive: boolean;
    mutations: number;
  } {
    return {
      playerId: this.playerId,
      plantId: this.plantId,
      growths: this.acceptedGrowths,
      nodes: this.nodes.size,
      rejects: this.rejected,
      alive: this.plantAlive,
      mutations: this.mutationsSeen.size,
    };
  }

  private summarise(): void {
    if (this.acceptedGrowths === 0) {
      this.findings.warn('no-growth', 'the bot never managed a single growth', {
        lastReject: this.lastRejectReason,
        nodes: this.nodes.size,
      });
    }
  }

  private log(message: string): void {
    if (!this.optionsIn.verbose) return;
    process.stdout.write(`[${this.optionsIn.name}] ${message}\n`);
  }
}
