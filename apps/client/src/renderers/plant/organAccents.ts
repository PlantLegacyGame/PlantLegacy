import * as THREE from 'three';

/**
 * Procedural accents that give a node type a silhouette of its own.
 *
 * The chain tube already draws the axis of every organ. This module adds the
 * parts a tube cannot express: a root cap and hairs, the rings of a rhizome or
 * culm, the storage body and eyes of a tuber, a floating pad, a thorn point, a
 * vine tendril and a stolon plantlet. Geometry is local to the segment: +Y runs
 * from the attachment to the tip, so the renderer can parent it to the existing
 * tube and let the tube's growth animation carry it.
 *
 * Nothing here touches materials or the scene graph; the renderer assigns the
 * organ material and owns disposal. Low segment counts are deliberate: these
 * are accent shapes seen at stem scale, not hero assets.
 */
export interface OrganAccentOptions {
  /** Mature length of the segment, metres. */
  length: number;
  /** Mature radius of the segment, metres. */
  radius: number;
  /** The morphology's tip silhouette, when the caller has a spec. */
  tip?: string;
  /** Appendages the morphology says this organ carries. */
  appendages?: readonly string[];
}

type AccentGroup = THREE.Group;

function mesh(
  geometry: THREE.BufferGeometry,
  position?: THREE.Vector3,
  quaternion?: THREE.Quaternion,
): THREE.Mesh {
  const object = new THREE.Mesh(geometry);
  if (position) object.position.copy(position);
  if (quaternion) object.quaternion.copy(quaternion);
  return object;
}

function sphere(x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const object = mesh(new THREE.SphereGeometry(1, 10, 7));
  object.position.set(x, y, z);
  object.scale.set(sx, sy, sz);
  return object;
}

function ring(y: number, radius: number, tubeRadius: number): THREE.Mesh {
  const object = mesh(new THREE.TorusGeometry(radius, tubeRadius, 6, 16));
  object.position.y = y;
  object.rotation.x = Math.PI / 2;
  return object;
}

function cylinder(
  x: number,
  y: number,
  z: number,
  radiusA: number,
  radiusB: number,
  height: number,
  tilt: number,
): THREE.Mesh {
  const object = mesh(new THREE.CylinderGeometry(radiusA, radiusB, height, 4));
  object.position.set(x, y, z);
  object.rotation.z = tilt;
  return object;
}

/** The cap that makes a root read as a root instead of a sharpened stick. */
function addRootCap(group: AccentGroup, length: number, radius: number): void {
  group.add(sphere(0, length, 0, radius * 0.82, radius * 0.7, radius * 0.82));
}

/** A few hairs, only where a fine feeder root would carry them. */
function addRootHairs(group: AccentGroup, length: number, radius: number): void {
  const height = Math.max(0.018, Math.min(0.09, length * 0.14));
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const at = length * (0.42 + i * 0.1);
    const x = Math.cos(angle) * radius * 0.85;
    const z = Math.sin(angle) * radius * 0.85;
    const hair = cylinder(x, at, z, radius * 0.12, radius * 0.04, height, Math.cos(angle) * 0.75);
    hair.rotation.y = angle;
    group.add(hair);
  }
}

function addRingedStem(
  group: AccentGroup,
  length: number,
  radius: number,
  ringCount: number,
): void {
  for (let i = 1; i <= ringCount; i += 1) {
    const at = (i / (ringCount + 1)) * length;
    group.add(ring(at, radius * 1.08, Math.max(0.0015, radius * 0.09)));
  }
}

/** A storage body hanging under a short stalk, with a few buds ("eyes"). */
function addTuber(group: AccentGroup, length: number, radius: number): void {
  const bodyY = Math.max(radius * 1.2, length * 0.86);
  const body = sphere(0, bodyY, 0, radius * 2.15, radius * 1.45, radius * 1.8);
  group.add(body);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const eye = sphere(
      Math.cos(angle) * radius * 1.55,
      bodyY + Math.sin(angle * 1.7) * radius * 0.75,
      Math.sin(angle) * radius * 1.25,
      radius * 0.16,
      radius * 0.12,
      radius * 0.16,
    );
    group.add(eye);
  }
}

/** A thin twining tendril that leaves the final third of a vine. */
function addTendril(group: AccentGroup, length: number, radius: number): void {
  const start = Math.max(0.03, length * 0.62);
  const turns = 2.4;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const angle = t * Math.PI * 2 * turns;
    const reach = radius * (2.2 + 0.8 * t);
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * reach,
        start + length * 0.38 * t,
        Math.sin(angle) * reach,
      ),
    );
  }
  const curve = new THREE.CatmullRomCurve3(points);
  group.add(mesh(new THREE.TubeGeometry(curve, 28, Math.max(0.0015, radius * 0.16), 4, false)));
}

/**
 * A buoyant pad with a real notch in its outline.
 *
 * A circle plus a raised wedge is not a notch: in silhouette the wedge is a
 * dark stripe on a whole pad. The shape below is cut from the centre to the
 * rim, so the missing wedge is missing geometry, not a painted-on mark.
 */
function addFloatingPad(group: AccentGroup, length: number, radius: number): void {
  const padRadius = Math.max(0.04, radius * 4.4);
  const notchHalf = 0.34;
  const start = -Math.PI / 2 + notchHalf;
  const end = (Math.PI * 3) / 2 - notchHalf;
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(start) * padRadius, Math.sin(start) * padRadius);
  shape.absarc(0, 0, padRadius, start, end, false);
  shape.lineTo(Math.cos(end) * padRadius * 0.3, Math.sin(end) * padRadius * 0.3);
  shape.lineTo(Math.cos(start) * padRadius * 0.3, Math.sin(start) * padRadius * 0.3);
  shape.closePath();
  const pad = mesh(new THREE.ShapeGeometry(shape, 28));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = length;
  pad.scale.y = 0.82;
  group.add(pad);
  // A slim rim follows the cut outline without closing the notch.
  const rimShape = shape.clone();
  const rim = mesh(new THREE.ShapeGeometry(rimShape, 28));
  rim.scale.set(0.95, 0.95, 1);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = length + radius * 0.004;
  rim.scale.y = 0.82;
  group.add(rim);
}

/** The hilum that turns a sphere into a seed. */
function addSeedDetail(group: AccentGroup, length: number, radius: number): void {
  // The coat itself is the renderer's seed body; the hilum is the scar that
  // makes it a seed rather than a sphere. There is deliberately no seam ring:
  // the torus used to sit at the top of the coat and read as a halo floating
  // over the seed, not as anatomy. A groove belongs in the coat's surface, not
  // as a separate hoop above it.
  // Sit on the upper front of the coat, not inside it and not on the crown.
  // The old mark was centred at 0.42 of the radius with a 0.18 bump, so the
  // whole thing was buried under the sphere and the seed read as a plain bead.
  // This shallow oval is tilted to the local surface so it reads as a scar
  // rather than a cap balanced on top.
  const hilum = sphere(
    0,
    length * 0.45,
    radius * 0.38,
    radius * 0.3,
    radius * 0.055,
    radius * 0.22,
  );
  hilum.rotation.x = 0.6;
  hilum.name = 'seed-hilum';
  group.add(hilum);
}

/** Node bands and the pale lenticels of a green stem. */
function addStemDetail(group: AccentGroup, length: number, radius: number): void {
  addRingedStem(group, length, radius, 2);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + 0.2;
    const at = length * (0.22 + (i % 3) * 0.24);
    const lenticel = sphere(
      Math.cos(angle) * radius * 0.98,
      at,
      Math.sin(angle) * radius * 0.98,
      radius * 0.18,
      radius * 0.05,
      radius * 0.1,
    );
    lenticel.rotation.y = -angle;
    group.add(lenticel);
  }
}

/** A branch's dormant buds and the first bark plates at its collar. */
function addBranchDetail(group: AccentGroup, length: number, radius: number): void {
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + 0.6;
    const bud = sphere(
      Math.cos(angle) * radius * 1.02,
      length * (0.3 + i * 0.22),
      Math.sin(angle) * radius * 1.02,
      radius * 0.2,
      radius * 0.32,
      radius * 0.2,
    );
    group.add(bud);
  }
  addRingedStem(group, length, radius, 1);
}

/** The widened foot where a trunk meets the soil. */
function addTrunkFlare(group: AccentGroup, length: number, radius: number): void {
  const flare = mesh(
    new THREE.ConeGeometry(radius * 2.3, Math.max(0.04, length * 0.2), 10, 1, true),
  );
  flare.position.y = Math.max(0.02, length * 0.08);
  group.add(flare);
  addRingedStem(group, length, radius, 3);
}

/** Midrib, lateral veins and a serrated edge on a leaf blade. */
function addLeafDetail(group: AccentGroup, length: number, radius: number): void {
  const width = Math.max(radius * 2.6, 0.04);
  const midrib = cylinder(0, length * 0.5, 0, radius * 0.22, radius * 0.08, length * 0.86, 0);
  group.add(midrib);
  for (let i = 1; i <= 3; i += 1) {
    const at = length * (0.24 + i * 0.18);
    for (const side of [-1, 1]) {
      const vein = cylinder(0, at, 0, radius * 0.06, radius * 0.02, width * 0.9, side * 0.9);
      vein.rotation.z = side * 0.55;
      group.add(vein);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    const t = (i + 1) / 9;
    const side = i % 2 === 0 ? 1 : -1;
    const tooth = mesh(new THREE.ConeGeometry(radius * 0.14, radius * 0.42, 4));
    tooth.position.set(side * width * 0.48, length * t, 0);
    tooth.rotation.z = (side * -Math.PI) / 2;
    group.add(tooth);
  }
}

/** Sepals under the bloom, anthers round the centre and a stigma on top. */
function addFlowerDetail(group: AccentGroup, length: number, radius: number): void {
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const sepal = mesh(new THREE.ConeGeometry(radius * 0.34, radius * 0.9, 5));
    sepal.position.set(
      Math.cos(angle) * radius * 0.62,
      length * 0.2,
      Math.sin(angle) * radius * 0.62,
    );
    sepal.rotation.z = Math.cos(angle) * 0.7;
    sepal.rotation.x = Math.sin(angle) * 0.7;
    group.add(sepal);
    const anther = sphere(
      Math.cos(angle) * radius * 0.55,
      length * 0.72,
      Math.sin(angle) * radius * 0.55,
      radius * 0.12,
      radius * 0.12,
      radius * 0.12,
    );
    group.add(anther);
  }
  const stigma = cylinder(0, length * 0.84, 0, radius * 0.08, radius * 0.18, radius * 0.45, 0);
  group.add(stigma);
}

/** The lid and spore ring of a moss capsule. */
function addSporeDetail(group: AccentGroup, length: number, radius: number): void {
  const operculum = mesh(new THREE.ConeGeometry(radius * 0.72, radius * 0.55, 8));
  operculum.position.y = length;
  group.add(operculum);
  group.add(ring(length * 0.9, radius * 0.8, Math.max(0.0012, radius * 0.08)));
}

/** Lenticels and the bark fissures that appear as a root thickens. */
function addRootDetail(group: AccentGroup, length: number, radius: number): void {
  addRootHairs(group, length, radius);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const fissure = mesh(new THREE.BoxGeometry(radius * 0.06, length * 0.22, radius * 0.04));
    fissure.position.set(
      Math.cos(angle) * radius * 0.94,
      length * (0.35 + (i % 2) * 0.18),
      Math.sin(angle) * radius * 0.94,
    );
    fissure.rotation.y = -angle;
    group.add(fissure);
  }
}

/** Overlapping scale leaves, buds and the first adventitious roots. */
function addRhizomeDetail(group: AccentGroup, length: number, radius: number): void {
  for (let i = 0; i < 4; i += 1) {
    const angle = (i % 2 === 0 ? 1 : -1) * 0.9;
    const scale = mesh(new THREE.ConeGeometry(radius * 0.55, radius * 0.9, 5));
    scale.position.set(Math.cos(angle) * radius * 0.72, length * (0.2 + i * 0.2), 0);
    scale.rotation.z = angle * 0.75;
    group.add(scale);
    const bud = sphere(
      Math.cos(angle) * radius * 0.8,
      length * (0.28 + i * 0.2),
      Math.sin(angle) * radius * 0.8,
      radius * 0.16,
      radius * 0.28,
      radius * 0.16,
    );
    group.add(bud);
  }
  for (let i = 0; i < 3; i += 1) {
    const rootlet = cylinder(
      (i - 1) * radius * 0.6,
      -radius * 0.2,
      0,
      radius * 0.14,
      radius * 0.03,
      length * 0.34,
      0.4,
    );
    group.add(rootlet);
  }
}

/** The leaf sheath and the pale silica band of a grass culm. */
function addCulmDetail(group: AccentGroup, length: number, radius: number): void {
  addRingedStem(group, length, radius, 2);
  const sheath = mesh(
    new THREE.CylinderGeometry(radius * 1.28, radius * 1.05, length * 0.28, 7, 1, true),
  );
  sheath.position.y = length * 0.22;
  group.add(sheath);
  const band = ring(length * 0.72, radius * 1.1, Math.max(0.002, radius * 0.12));
  group.add(band);
}

/** A stolon's own plantlet: a tiny blade at the node that has rooted. */
function addStolonPlantlet(group: AccentGroup, length: number, radius: number): void {
  group.add(ring(length * 0.82, radius * 0.9, Math.max(0.0015, radius * 0.1)));
  const leaf = mesh(new THREE.CircleGeometry(Math.max(0.03, radius * 3.2), 14));
  leaf.rotation.x = -Math.PI / 2 + 0.35;
  leaf.position.set(radius * 1.6, length, radius * 0.2);
  leaf.scale.z = 0.55;
  group.add(leaf);
}

/** The hard point of a thorn, replacing the blunt tube end. */
function addThornPoint(group: AccentGroup, length: number, radius: number): void {
  const height = Math.max(0.05, length * 0.65);
  const point = mesh(new THREE.ConeGeometry(radius * 0.95, height, 7));
  point.position.y = length;
  group.add(point);
}

/** A breathing root's spongy tip, wider than its own shank. */
function addPneumatophoreTip(group: AccentGroup, length: number, radius: number): void {
  group.add(sphere(0, length, 0, radius * 1.45, radius * 1.15, radius * 1.45));
  group.add(ring(length * 0.72, radius * 1.15, Math.max(0.0015, radius * 0.12)));
}

/** Build the accent group for one organ; every node type has anatomy here. */
export function buildOrganAccents(
  nodeType: string,
  options: OrganAccentOptions,
): AccentGroup | null {
  const type = nodeType.toLowerCase();
  const length = Math.max(0.01, options.length);
  const radius = Math.max(0.002, options.radius);
  const group = new THREE.Group();
  group.name = `organ-accent:${type}`;

  switch (type) {
    case 'seed':
      addSeedDetail(group, length, radius);
      break;
    case 'radicle':
      addRootCap(group, length, radius);
      break;
    case 'root':
    case 'lateral_root':
      addRootCap(group, length, radius);
      addRootDetail(group, length, radius);
      break;
    case 'stem':
      addStemDetail(group, length, radius);
      break;
    case 'branch':
      addBranchDetail(group, length, radius);
      break;
    case 'trunk':
      addTrunkFlare(group, length, radius);
      break;
    case 'leaf':
    case 'cotyledon':
      addLeafDetail(group, length, radius);
      break;
    case 'flower':
      addFlowerDetail(group, length, radius);
      break;
    case 'spore_sac':
      addSporeDetail(group, length, radius);
      break;
    case 'rhizome':
      addRhizomeDetail(group, length, radius);
      break;
    case 'culm':
      addCulmDetail(group, length, radius);
      break;
    case 'tuber':
      addTuber(group, length, radius);
      break;
    case 'floating_leaf':
      addFloatingPad(group, length, radius);
      break;
    case 'pneumatophore':
      addPneumatophoreTip(group, length, radius);
      break;
    case 'thorn':
      addThornPoint(group, length, radius);
      break;
    case 'stolon':
      addStolonPlantlet(group, length, radius);
      break;
    case 'vine':
      addTendril(group, length, radius);
      break;
    default:
      return null;
  }

  if (group.children.length === 0) return null;
  // The accents are parts of the plant, so they cast and receive the same light
  // as the tube they sit on; the renderer assigns the material and shadows.
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  }
  return group;
}
