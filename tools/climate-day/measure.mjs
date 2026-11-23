#!/usr/bin/env node
/**
 * Replay the shipped climate for whole days and report what the weather did.
 *
 * This is the measurement the 30-day test only asserts bounds on: wet share,
 * storms, snow and state durations, plus the field's own temperature and
 * humidity along the way. It builds the same `WeatherSystem` the server builds,
 * from the same config files, with the real terrain field, so a run at the
 * live anchor and season is the day the server should have.
 *
 * Usage:
 *   node tools/climate-day/measure.mjs --days=1
 *   node tools/climate-day/measure.mjs --days=30 --compress-year --hill
 *
 * Options:
 *   --days=N            whole days to simulate (default 1)
 *   --season=N          1-based season to start in (default 1: spring)
 *   --progress=F        fraction through the season at the start (0..1)
 *   --time-of-day=F     world clock at the start, 0 midnight, 0.25 sunrise
 *   --anchor-x=M        climate anchor x (default 0)
 *   --anchor-z=M        climate anchor z (default 0)
 *   --hill              use the test ridge instead of the shipped terrain
 *   --compress-year     advance a whole year over the run (the 30-day test)
 *   --humidity-base=F   override the field's mean humidity, for tuning
 *   --cloud-threshold=F override the humidity at which cloud begins, for tuning
 *   --step=S            simulation step in seconds (default 1)
 *   --from=S            start the log window S seconds after the last boot
 *   --json              print only the JSON report
 *
 * A live day can be read back from the server log as well, which is the
 * authoritative record of what the running world actually did:
 *   node tools/climate-day/measure.mjs --log=path/to/server.log --from=600
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigDir, readNumber } from '../../packages/shared/src/config/index.ts';
import { terrainHeightAt } from '../../packages/shared/src/world/terrainField.ts';
import { loadTerrainFieldParams } from '../../packages/shared/src/world/terrainFieldConfig.ts';
import {
  loadClimateConfig,
  loadDayNightConfig,
  loadWeatherConfig,
  WeatherSystem,
} from '../../packages/weather/src/weather.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const hasFlag = (name) => process.argv.slice(2).includes(`--${name}`);

// The shipped configs, through the same loaders the server and the 30-day test
// use. A hand-copied table with its own fallbacks measures whatever the tool
// remembers rather than what the game ships — its river was 7 m wide against 12
// and its rain began at 0.22 against 0.28 — and a missing key now throws.
const loaded = await loadConfigDir(path.join(ROOT, 'config'));
if (!loaded.ok) {
  const [issue] = loaded.issues;
  throw new Error(`config load failed: ${issue ? `${issue.file}: ${issue.message}` : 'unknown'}`);
}
const { configs } = loaded;
const climate = loadClimateConfig(configs);
const weather = loadWeatherConfig(configs);
const dayNight = loadDayNightConfig(configs);

// The same loader the server builds its ground from, so the two cannot drift.
const terrainParams = loadTerrainFieldParams(configs);

const seasonLengthDays = Math.max(1, readNumber(configs, 'world', 'season_length_days'));
const days = Math.max(1, Math.round(Number(arg('days', '1'))));
const season = Math.max(1, Math.round(Number(arg('season', '1'))));
const progress = Number(arg('progress', '0'));
const startTimeOfDay = Number(arg('time-of-day', '0.25'));
const anchorX = Number(arg('anchor-x', '0'));
const anchorZ = Number(arg('anchor-z', '0'));
const step = Math.max(0.1, Number(arg('step', '1')));
const compressYear = hasFlag('compress-year');
const useHill = hasFlag('hill');
const jsonOnly = hasFlag('json');
const humidityBase = arg('humidity-base', null);
if (humidityBase !== null && Number.isFinite(Number(humidityBase))) {
  climate.humidityBase = Number(humidityBase);
}
const cloudThreshold = arg('cloud-threshold', null);
if (cloudThreshold !== null && Number.isFinite(Number(cloudThreshold))) {
  climate.cloudThreshold = Number(cloudThreshold);
}
const logPath = arg('log', null);

/** The 30-day test's ridge, for comparing against that run. */
function hill(x, z) {
  return 45 * Math.exp(-(x * x + z * z) / (2 * 130 * 130));
}

const system = new WeatherSystem(weather, dayNight, climate);
system.setTerrainSampler(useHill ? hill : (x, z) => terrainHeightAt(terrainParams, x, z));
system.setClimateAnchor(anchorX, anchorZ);
system.setTimeOfDay(startTimeOfDay);

const daySeconds = dayNight.cycleLengthS;
const totalSeconds = days * daySeconds;
// Spring begins at phase 0. The live calendar spends `season_length_days` real
// days on each quarter; the compressed run spends the whole run on a year.
const progressPerSecond = compressYear ? 4 / totalSeconds : 1 / (seasonLengthDays * 86_400);
const startProgress = Number.isFinite(progress) ? ((progress % 1) + 1) % 1 : 0;
const phaseAt = (seconds) =>
  ((((season - 1 + startProgress + seconds * progressPerSecond) % 4) + 4) % 4) / 4;

function printReport(report) {
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const where = report.anchor
    ? `anchor ${report.anchor.x},${report.anchor.z}`
    : report.bootTs
      ? `boot ${report.bootTs}`
      : '';
  const scope = report.complete === false ? ' (partial)' : '';
  const from = report.fromSeconds > 0 ? ` from ${Math.round(report.fromSeconds)}s` : '';
  console.log(
    `source: ${report.source}, ${report.mode}, ${report.days} day(s)${where ? `, ${where}` : ''}${from}${scope}`,
  );
  console.log(
    `wet ${(report.wetShare * 100).toFixed(1)}%  snow ${(report.snowShare * 100).toFixed(2)}%  storms ${report.storms}  transitions ${report.transitions}  mean state ${report.meanStateSeconds.toFixed(0)}s`,
  );
  const field = report.field;
  if (Number.isFinite(field.minTemperatureC)) {
    console.log(
      `temperature ${field.minTemperatureC.toFixed(1)}..${field.maxTemperatureC.toFixed(1)} C  humidity mean ${field.meanHumidity.toFixed(3)}  max precipitation ${field.maxPrecipitation.toFixed(3)}`,
    );
  }
  console.log(`states ${JSON.stringify(report.stateSeconds)}`);
  for (const day of report.perDay) {
    console.log(
      `  day ${day.day}: wet ${(day.wetShare * 100).toFixed(1)}%  snow ${Math.round(day.snowSeconds)}s  storms ${day.storms}  transitions ${day.transitions}`,
    );
  }
  if (Number.isFinite(field.aboveRainStartShare)) {
    console.log(
      `  field asked for rain ${(field.aboveRainStartShare * 100).toFixed(1)}% of samples, above the stop ${(field.aboveRainStopShare * 100).toFixed(1)}%`,
    );
  }
}

if (logPath) {
  const text = await readFile(logPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let bootIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('"msg":"listening"')) bootIndex = i;
  }
  if (bootIndex < 0) throw new Error(`no server boot in ${logPath}`);

  let bootTs = null;
  let tickRateHz = 20;
  const events = [];
  for (let i = bootIndex; i < lines.length; i += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.msg === 'listening') bootTs = entry.ts;
    if (entry.msg === 'world simulation started' && Number.isFinite(entry.tickRateHz)) {
      tickRateHz = entry.tickRateHz;
    }
    if (entry.msg === 'weather changed') events.push(entry);
  }

  // A window can start anywhere after the boot: a world driven into winter
  // mid-day is measured from the moment it became winter, not from tick zero.
  const fromSeconds = Math.max(0, Number(arg('from', '0')) || 0);
  const startTick = Math.round(fromSeconds * tickRateHz);
  const dayTicks = daySeconds * tickRateHz;
  const windowTicks = days * dayTicks;
  // The log has no heartbeat, so the wall clock since boot is the only end
  // marker. Server time is real time; only a restart changes that.
  const elapsedTicks = bootTs
    ? Math.max(0, Math.floor((Date.now() - Date.parse(bootTs)) / 1000) * tickRateHz)
    : 0;
  const endTick = Math.max(startTick, Math.min(startTick + windowTicks, elapsedTicks));

  const stateSeconds = {};
  const transitions = [];
  const dayTotals = Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    // A window that starts mid-day, or that is still running, has less than a
    // day in it: the share must be of the seconds actually observed, or a
    // partial day reads as a dry day next to the window's own 18.7%.
    observedSeconds: 0,
    wetSeconds: 0,
    snowSeconds: 0,
    storms: 0,
    transitions: 0,
  }));
  const spans = [];
  let state = 'clear';
  let cursor = startTick;
  for (const event of events) {
    if (typeof event.tick !== 'number') continue;
    // The window opens in whatever state the previous transition left behind.
    if (event.tick <= startTick) {
      state = event.to;
      continue;
    }
    if (event.tick >= endTick) break;
    spans.push({ state, from: cursor, to: event.tick });
    transitions.push({
      t: Number((event.tick / tickRateHz).toFixed(1)),
      from: state,
      to: event.to,
      timeOfDay: event.timeOfDay,
      season: event.season,
      sample: {
        temperatureC: event.temperatureC,
        humidity: event.humidity,
        cloud: event.cloud,
        precipitation: event.precipitation,
      },
    });
    const dayIndex = Math.min(days - 1, Math.floor((event.tick - startTick) / dayTicks));
    dayTotals[dayIndex].transitions += 1;
    if (event.to === 'thunderstorm_telegraph') dayTotals[dayIndex].storms += 1;
    state = event.to;
    cursor = event.tick;
  }
  spans.push({ state, from: cursor, to: endTick });

  let wetSeconds = 0;
  let snowSeconds = 0;
  for (const span of spans) {
    if (span.to <= span.from) continue;
    const wet =
      span.state === 'rain' || span.state === 'snow' || span.state.startsWith('thunderstorm');
    let from = span.from;
    while (from < span.to) {
      const dayIndex = Math.min(days - 1, Math.floor((from - startTick) / dayTicks));
      const portionEnd = Math.min(span.to, startTick + (dayIndex + 1) * dayTicks);
      const seconds = (portionEnd - from) / tickRateHz;
      stateSeconds[span.state] = (stateSeconds[span.state] ?? 0) + seconds;
      dayTotals[dayIndex].observedSeconds += seconds;
      if (wet) {
        wetSeconds += seconds;
        dayTotals[dayIndex].wetSeconds += seconds;
      }
      if (span.state === 'snow') {
        snowSeconds += seconds;
        dayTotals[dayIndex].snowSeconds += seconds;
      }
      from = portionEnd;
    }
  }

  const temperatures = transitions
    .map((entry) => entry.sample.temperatureC)
    .filter(Number.isFinite);
  const humidities = transitions.map((entry) => entry.sample.humidity).filter(Number.isFinite);
  const observedSeconds = (endTick - startTick) / tickRateHz;
  printReport({
    mode: 'live-log',
    source: logPath,
    days,
    bootTs,
    fromSeconds,
    observedSeconds,
    complete: observedSeconds >= totalSeconds,
    wetShare: observedSeconds > 0 ? wetSeconds / observedSeconds : 0,
    snowShare: observedSeconds > 0 ? snowSeconds / observedSeconds : 0,
    storms: transitions.filter((entry) => entry.to === 'thunderstorm_telegraph').length,
    transitions: transitions.length,
    meanStateSeconds: transitions.length ? observedSeconds / transitions.length : observedSeconds,
    stateSeconds,
    field: {
      minTemperatureC: temperatures.length ? Math.min(...temperatures) : null,
      maxTemperatureC: temperatures.length ? Math.max(...temperatures) : null,
      meanHumidity: humidities.length
        ? humidities.reduce((sum, value) => sum + value, 0) / humidities.length
        : null,
      maxPrecipitation: Math.max(0, ...transitions.map((entry) => entry.sample.precipitation ?? 0)),
      aboveRainStartShare: null,
      aboveRainStopShare: null,
    },
    perDay: dayTotals.map((day) => ({
      ...day,
      wetShare: day.wetSeconds / Math.max(1, day.observedSeconds),
    })),
    transitionLog: transitions,
  });
  process.exit(0);
}

const stateSeconds = {};
const transitions = [];
const samples = [];
const perDay = [];
let wetSeconds = 0;
let snowSeconds = 0;
let storms = 0;
let lastState = system.getWeatherState();
let currentDay = { day: 1, wetSeconds: 0, snowSeconds: 0, storms: 0, transitions: 0 };

for (let t = 0; t < totalSeconds; t += step) {
  system.setSeasonPhase(phaseAt(t));
  if (t % 60 === 0) {
    const sample = system.getClimateSample();
    if (sample) {
      samples.push({
        t,
        temperatureC: sample.temperatureC,
        humidity: sample.humidity,
        cloud: sample.cloud,
        precipitation: sample.precipitation,
      });
    }
  }

  system.update(step);
  const state = system.getWeatherState();
  stateSeconds[state] = (stateSeconds[state] ?? 0) + step;

  const wet = state === 'rain' || state === 'snow' || state.startsWith('thunderstorm');
  if (wet) {
    wetSeconds += step;
    currentDay.wetSeconds += step;
  }
  if (state === 'snow') {
    snowSeconds += step;
    currentDay.snowSeconds += step;
  }
  if (state !== lastState) {
    transitions.push({
      t: Math.round(t),
      from: lastState,
      to: state,
      dayNumber: Math.floor(t / daySeconds) + 1,
      timeOfDay: Number(system.getTimeOfDay().toFixed(4)),
      seasonPhase: Number(phaseAt(t).toFixed(4)),
      sample: system.getClimateSample(),
    });
    currentDay.transitions += 1;
    if (state === 'thunderstorm_telegraph') {
      storms += 1;
      currentDay.storms += 1;
    }
    lastState = state;
  }

  if (currentDay.day < days && t + step >= currentDay.day * daySeconds) {
    perDay.push({ ...currentDay, wetShare: currentDay.wetSeconds / daySeconds });
    currentDay = {
      day: currentDay.day + 1,
      wetSeconds: 0,
      snowSeconds: 0,
      storms: 0,
      transitions: 0,
    };
  }
}
perDay.push({ ...currentDay, wetShare: currentDay.wetSeconds / daySeconds });

const temperatures = samples.map((sample) => sample.temperatureC);
const humidities = samples.map((sample) => sample.humidity).sort((a, b) => a - b);
const percentile = (p) =>
  humidities[Math.min(humidities.length - 1, Math.floor(p * humidities.length))];
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length);

const report = {
  mode: compressYear ? 'compressed-year' : 'live-season',
  source: useHill ? 'test hill' : 'shipped terrain',
  days,
  season,
  seasonLengthDays,
  startProgress,
  startTimeOfDay,
  phaseAtStart: phaseAt(0),
  phaseAtEnd: phaseAt(totalSeconds),
  anchor: { x: anchorX, z: anchorZ },
  anchorHeightM: Number(
    (useHill ? hill(anchorX, anchorZ) : terrainHeightAt(terrainParams, anchorX, anchorZ)).toFixed(
      2,
    ),
  ),
  totalSeconds,
  wetShare: wetSeconds / totalSeconds,
  snowShare: snowSeconds / totalSeconds,
  storms,
  transitions: transitions.length,
  meanStateSeconds: totalSeconds / Math.max(1, transitions.length),
  stateSeconds,
  field: {
    minTemperatureC: Math.min(...temperatures),
    maxTemperatureC: Math.max(...temperatures),
    meanHumidity: mean(humidities),
    humidityP10: percentile(0.1),
    humidityP50: percentile(0.5),
    humidityP80: percentile(0.8),
    humidityP95: percentile(0.95),
    humidityMax: humidities[humidities.length - 1],
    maxCloud: Math.max(...samples.map((sample) => sample.cloud)),
    maxPrecipitation: Math.max(...samples.map((sample) => sample.precipitation)),
    // How often the field itself asks for rain, next to how often the state
    // machine granted it. A large gap is the machine, not the sky.
    aboveRainStartShare:
      samples.filter((sample) => sample.precipitation >= climate.precipitationStart).length /
      Math.max(1, samples.length),
    aboveRainStopShare:
      samples.filter((sample) => sample.precipitation > climate.precipitationStop).length /
      Math.max(1, samples.length),
  },
  perDay,
  transitionLog: transitions,
};

printReport(report);
