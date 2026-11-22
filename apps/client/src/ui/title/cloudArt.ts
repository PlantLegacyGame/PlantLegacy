/**
 * Cloud silhouettes.
 *
 * Six families, because a single generator with one size parameter makes every
 * cloud look like the same cloud scaled: a low bank, a tall cumulus, a thin wisp,
 * a building tower, a flat veil and a small puff. Each is built from ellipses
 * whose extents are computed, so the viewBox always contains the whole shape - the
 * first version let puffs run past the right edge and the sky cropped them into
 * straight cuts.
 *
 * A family can be asked for by name (`skyLayout` does, so the table decides what
 * the sky looks like) or left to the seed, which is what the old sky did.
 */
export type CloudFamily = 'bank' | 'cumulus' | 'wisp' | 'tower' | 'veil' | 'puff';

export interface Puff {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function makeRng(seed: number): () => number {
  let state = ((seed + 1) * 2654435761) % 2147483647;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

export function buildPuffs(family: CloudFamily, rng: () => number): Puff[] {
  const puffs: Puff[] = [];

  if (family === 'bank') {
    const count = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const middle = Math.sin(t * Math.PI);
      puffs.push({
        cx: 26 + t * 148 + (rng() - 0.5) * 8,
        cy: 56 - middle * (10 + rng() * 6),
        rx: 20 + middle * 12 + rng() * 5,
        ry: 13 + middle * 9 + rng() * 4,
      });
    }
    return puffs;
  }

  if (family === 'tower') {
    // A cumulus that kept building: a low base, a shoulder, and two crown tiers
    // narrowing to a cap. The tiers are what make it read as height rather than as
    // a larger cumulus.
    puffs.push({ cx: 40, cy: 62, rx: 26 + rng() * 4, ry: 15 });
    puffs.push({ cx: 74, cy: 61, rx: 24, ry: 16 });
    puffs.push({ cx: 58, cy: 48, rx: 26 + rng() * 3, ry: 17 });
    puffs.push({ cx: 86, cy: 44, rx: 16, ry: 13 });
    puffs.push({ cx: 62, cy: 30, rx: 18, ry: 14 + rng() * 3 });
    puffs.push({ cx: 50, cy: 22, rx: 11, ry: 9 });
    puffs.push({ cx: 78, cy: 18, rx: 10, ry: 9 + rng() * 3 });
    return puffs;
  }

  if (family === 'veil') {
    // A sheet of high cloud: wide, flat, a row of overlapping long ellipses with
    // tiny height, so it reads as air rather than as a body. Nothing here is a
    // sausage: the lumps are what keep a flat sheet from ruling a line across the
    // sky.
    const layers = 5 + Math.floor(rng() * 2);
    for (let i = 0; i < layers; i += 1) {
      const t = layers === 1 ? 0.5 : i / (layers - 1);
      puffs.push({
        cx: 44 + t * 118 + (rng() - 0.5) * 10,
        cy: 50 + Math.sin(t * Math.PI) * -4 + (rng() - 0.5) * 4,
        rx: 32 + rng() * 12,
        ry: 5 + rng() * 3,
      });
    }
    return puffs;
  }

  if (family === 'puff') {
    // Three or four round puffs close together: a fair-weather cumulus, the sort
    // that sits alone in a blue sky.
    const count = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      puffs.push({
        cx: 42 + t * 58 + (rng() - 0.5) * 6,
        cy: 48 - Math.sin(t * Math.PI) * 9,
        rx: 15 + rng() * 6,
        ry: 12 + rng() * 5,
      });
    }
    return puffs;
  }

  if (family === 'cumulus') {
    // A tall mass over a base tier. The base puffs all end on the same line: the
    // first version put one wide puff thirty pixels below the rest, so the cloud
    // had a single sausage hanging off one side instead of a base, and no flat
    // underside was possible without shaving that puff into a shelf.
    puffs.push({ cx: 34, cy: 62, rx: 28 + rng() * 4, ry: 18 });
    puffs.push({ cx: 70, cy: 61, rx: 32, ry: 19 });
    puffs.push({ cx: 104, cy: 59, rx: 28, ry: 21 });
    // Shoulder and crown, climbing to the right, then a cap.
    puffs.push({ cx: 128, cy: 47, rx: 19 + rng() * 3, ry: 16 });
    puffs.push({ cx: 86, cy: 37, rx: 23, ry: 19 + rng() * 4 });
    puffs.push({ cx: 106, cy: 22, rx: 15, ry: 13 + rng() * 3 });
    return puffs;
  }

  // Wisp: a long, thin streak with a couple of soft lumps.
  const lumps = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < lumps; i += 1) {
    const t = i / (lumps - 1);
    puffs.push({
      cx: 30 + t * 150,
      cy: 46 + Math.sin(t * Math.PI) * -6 + (rng() - 0.5) * 4,
      rx: 24 + rng() * 10,
      ry: 6 + rng() * 3,
    });
  }
  return puffs;
}

/**
 * One cloud, as SVG.
 *
 * The underside is the part that kept going wrong. Drawing a rounded bar under
 * the puffs to "flatten" the base put its bottom edge five pixels below the
 * lowest puff and three pixels past it at each end, so every cloud in the sky had
 * a straight line hanging under it; the hard drop shadow underneath doubled it.
 * Three rules replace that, and any one of them alone would be enough:
 *
 * 1. No clipping, at all. The base was a clip path for two passes, and every
 *    version of it put a light rectangle over the element box: the clip region is
 *    a shape in the sky, and the browser blended it as one - a box the size of the
 *    SVG, visible where the cloud was thin. The puffs are trimmed by geometry
 *    instead (their radii are shortened to the base line below), so there is no
 *    clip region to leak and the base is a row of soft scallops.
 * 2. No drawn band under the puffs: a bar has corners of its own, and those
 *    corners hung past the silhouette.
 * 3. No drop shadow. A cloud has no cast shadow in the sky, and the soft copy of
 *    the silhouette was the line's other half. The body is shaded instead: one
 *    user-space gradient ramps crown to base, so the cloud is lit as a single
 *    mass rather than each puff being shaded as its own egg.
 */
export function cloudArt(seed: number, kind: CloudFamily | 'high' | null = null): string {
  const rng = makeRng(seed);
  // No family asked for is the old behaviour: the seed picks from the three the
  // sky used to have, so a caller that only has a seed still gets variety.
  const family: CloudFamily =
    kind === null
      ? ((['bank', 'cumulus', 'wisp'] as const)[seed % 3] ?? 'bank')
      : kind === 'high'
        ? 'wisp'
        : kind;
  const puffs = buildPuffs(family, rng);

  // Bounds from the geometry itself, then a margin: nothing can be cropped.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = 0;
  for (const p of puffs) {
    minX = Math.min(minX, p.cx - p.rx);
    maxX = Math.max(maxX, p.cx + p.rx);
    minY = Math.min(minY, p.cy - p.ry);
    maxY = Math.max(maxY, p.cy + p.ry);
  }
  const pad = 10;
  const width = Math.ceil(maxX - minX + pad * 2);
  const shiftX = pad - minX;
  const shiftY = pad - minY;
  const id = `cl${seed}`;

  // Where the cloud sits: the crown, and the underside. The underside is a cut
  // through the puffs, not a bar drawn under them: a bar has bottom corners of its
  // own, and those corners hang past the silhouette. The first cut was a straight
  // line, which fixed the bar and left a ruler edge - every cloud in the sky ended
  // on the same perfectly level rule. It is a shallow wave now (see `underside`),
  // so the base lifts and settles the way a billow does, and it still cannot put
  // anything below the wave's own trough.
  const crownY = minY + shiftY;
  const lowestPuffY = maxY + shiftY;
  // How far down the cloud the cut falls, and only the bank gets one. A bank is
  // built from puffs that stand on roughly one line, so a cut through them trims
  // the underside evenly. A cumulus is a tower with a low wide puff on one side:
  // cutting it slices that puff into a slab that sticks out past the puffs above
  // it. Its own billows are the right bottom, and a wisp is a streak with soft
  // ends.
  const cutFraction =
    family === 'bank'
      ? 0.85
      : family === 'cumulus'
        ? 0.93
        : family === 'tower'
          ? 0.95
          : family === 'puff'
            ? 0.9
            : family === 'veil'
              ? 0.92
              : 1;
  const baseY = crownY + (lowestPuffY - crownY) * cutFraction;
  const height = baseY;

  // The base, trimmed by geometry: a puff that would hang below the base line keeps
  // its centre and has its radius shortened until its bottom sits on the line. The
  // union of the shortened puffs is the silhouette, so the underside is a row of
  // scallops with nothing drawn under it and nothing to clip.
  const placed = puffs.map((p) => {
    const rawCy = p.cy + shiftY;
    const cy = Math.min(rawCy, baseY - 2);
    const ry = Math.min(p.ry, Math.max(2, baseY - cy));
    return { cx: p.cx + shiftX, cy, rx: p.rx, ry };
  });

  // Rounded down, not to nearest: rounding a trimmed puff up by a tenth puts it
  // back below the base line, which is the thing the trim exists to prevent.
  const floor1 = (value: number): string => (Math.floor(value * 10) / 10).toFixed(1);
  const puffsMarkup = placed
    .map(
      (p) =>
        `<ellipse cx="${floor1(p.cx)}" cy="${floor1(p.cy)}" rx="${floor1(p.rx)}" ry="${floor1(p.ry)}"/>`,
    )
    .join('');

  // Lit tops: the crown only. Lighting the low puffs too turned the base of a
  // cumulus into a pale sausage bolted to the side of the tower.
  const crownLine = crownY + (lowestPuffY - crownY) * 0.55;
  const highlights = placed
    .filter((p) => p.cy < crownLine)
    .map(
      (p) =>
        `<ellipse cx="${(p.cx - 2).toFixed(1)}" cy="${(p.cy - p.ry * 0.46).toFixed(1)}" ` +
        `rx="${(p.rx * 0.56).toFixed(1)}" ry="${(p.ry * 0.44).toFixed(1)}"/>`,
    )
    .join('');

  // And a tighter core on the sun side of each of those puffs. A lit top is a sheen;
  // a smaller, brighter spot inside it is what makes a cumulus look like it is
  // holding light rather than painted with it. Same rule as the crown: high puffs
  // only, so the base of a tower does not get a white belly.
  const cores = placed
    .filter((p) => p.cy < crownLine && p.ry > 8)
    .map(
      (p) =>
        `<ellipse cx="${(p.cx - p.rx * 0.22).toFixed(1)}" cy="${(p.cy - p.ry * 0.58).toFixed(1)}" ` +
        `rx="${(p.rx * 0.3).toFixed(1)}" ry="${(p.ry * 0.24).toFixed(1)}"/>`,
    )
    .join('');

  return (
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">` +
    '<defs>' +
    // userSpaceOnUse: one ramp across the whole cloud, not one per puff.
    `<linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${crownY.toFixed(1)}" x2="0" y2="${baseY.toFixed(1)}">` +
    '<stop offset="0" stop-color="var(--pl-cloud-light)"/>' +
    // The underside is the darkest part of a cloud. It is the bottom of the same
    // ramp, not a band drawn on top of it: a band has its own edges, and every edge
    // it had was a rectangle showing through the sky where the cloud was thinner.
    '<stop offset="0.46" stop-color="var(--pl-cloud)"/>' +
    '<stop offset="0.9" stop-color="var(--pl-cloud-shade)"/>' +
    '<stop offset="1" stop-color="var(--pl-cloud-shade)"/>' +
    '</linearGradient>' +
    '</defs>' +
    `<g fill="url(#${id}b)">${puffsMarkup}</g>` +
    '<g fill="var(--pl-cloud-light)" opacity="0.28" ' +
    'style="transform: translate(var(--pl-cloud-lit-x, 0px), 0)">' +
    highlights +
    '</g>' +
    '<g fill="var(--pl-cloud-light)" opacity="0.34" ' +
    'style="transform: translate(var(--pl-cloud-lit-x, 0px), 0)">' +
    cores +
    '</g>' +
    '</svg>'
  );
}
