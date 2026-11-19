/**
 * Cloud silhouettes.
 *
 * Three families, because a single generator with one size parameter makes every
 * cloud look like the same cloud scaled: a low bank, a tall cumulus, and a thin
 * wisp. Each is built from ellipses whose extents are computed, so the viewBox
 * always contains the whole shape - the first version let puffs run past the
 * right edge and the sky cropped them into straight cuts.
 */
export type CloudFamily = 'bank' | 'cumulus' | 'wisp';

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
 * 1. A clip path at the base height: nothing is drawn below it, so a shape bug
 *    cannot put a line under a cloud again.
 * 2. The base band's width is measured from the puff union at the band's own top
 *    edge, so it fills the scalloped gaps between puffs and cannot overhang.
 * 3. No drop shadow. A cloud has no cast shadow in the sky, and the soft copy of
 *    the silhouette was the line's other half. The body is shaded instead: one
 *    user-space gradient ramps crown to base, so the cloud is lit as a single
 *    mass rather than each puff being shaded as its own egg.
 */
export function cloudArt(seed: number, layer: 'bank' | 'high' = 'bank'): string {
  const rng = makeRng(seed);
  const family: CloudFamily =
    layer === 'high' ? 'wisp' : ((['bank', 'cumulus', 'wisp'] as const)[seed % 3] ?? 'bank');
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
  const cutFraction = family === 'bank' ? 0.85 : family === 'cumulus' ? 0.93 : 1;
  const baseY = crownY + (lowestPuffY - crownY) * cutFraction;
  const height = baseY;

  // The underside, as a wave: contacts on the base line with soft lifts between
  // them. Amplitude scales with the cloud so a low bank does not get a cirrus-sized
  // ripple, and each segment draws its own lift so the rhythm is not a metronome.
  const underside = ((): string => {
    if (family === 'wisp') return `M0 0 H${width.toFixed(1)} V${baseY.toFixed(1)} H0 Z`;
    const span = Math.max(24, width / Math.max(3, Math.round(width / 46)));
    const segments = Math.max(3, Math.round(width / span));
    const amp = Math.min(4.2, Math.max(1.4, (baseY - crownY) * 0.07));
    let d = `M0 0 H${width.toFixed(1)} V${baseY.toFixed(1)}`;
    for (let i = segments; i > 0; i -= 1) {
      const right = (width * i) / segments;
      const left = (width * (i - 1)) / segments;
      const lift = amp * (0.5 + rng() * 0.9);
      d += ` Q${((left + right) / 2).toFixed(1)} ${(baseY - lift).toFixed(1)} ${left.toFixed(1)} ${baseY.toFixed(1)}`;
    }
    return `${d} Z`;
  })();

  const puffsMarkup = puffs
    .map(
      (p) =>
        `<ellipse cx="${(p.cx + shiftX).toFixed(1)}" cy="${(p.cy + shiftY).toFixed(1)}" rx="${p.rx.toFixed(1)}" ry="${p.ry.toFixed(1)}"/>`,
    )
    .join('');

  // Lit tops: the crown only. Lighting the low puffs too turned the base of a
  // cumulus into a pale sausage bolted to the side of the tower.
  const crownLine = crownY + (lowestPuffY - crownY) * 0.55;
  const highlights = puffs
    .filter((p) => p.cy + shiftY < crownLine)
    .map(
      (p) =>
        `<ellipse cx="${(p.cx + shiftX - 2).toFixed(1)}" cy="${(p.cy + shiftY - p.ry * 0.46).toFixed(1)}" ` +
        `rx="${(p.rx * 0.56).toFixed(1)}" ry="${(p.ry * 0.44).toFixed(1)}"/>`,
    )
    .join('');

  const clipId = `${id}k`;
  return (
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">` +
    '<defs>' +
    `<clipPath id="${clipId}"><path d="${underside}"/></clipPath>` +
    // userSpaceOnUse: one ramp across the whole cloud, not one per puff.
    `<linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="0" y1="${crownY.toFixed(1)}" x2="0" y2="${baseY.toFixed(1)}">` +
    '<stop offset="0" stop-color="var(--pl-cloud-light)"/>' +
    '<stop offset="0.52" stop-color="var(--pl-cloud)"/>' +
    '<stop offset="1" stop-color="var(--pl-cloud-shade)"/>' +
    '</linearGradient>' +
    '</defs>' +
    `<g clip-path="url(#${clipId})">` +
    `<g fill="url(#${id}b)">${puffsMarkup}</g>` +
    '<g fill="var(--pl-cloud-light)" opacity="0.28" ' +
    'style="transform: translate(var(--pl-cloud-lit-x, 0px), 0)">' +
    highlights +
    '</g>' +
    '</g>' +
    '</svg>'
  );
}
