import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configureMutationVisuals,
  DEFAULT_MUTATION_VISUAL_CAPS,
  encodeMutationSignature,
  geometryKey,
  lookAppliesTo,
  lookForOrgans,
  lookFromMutations,
  lookIsNeutral,
  MUTATION_MASK_LIMIT,
  type MutationVisualStyle,
  mutationMaskHas,
  mutationStyleById,
  mutationVisualStyleCount,
  NEUTRAL_LOOK,
  NEUTRAL_STACK,
  nodeMutationMask,
  organFamily,
  organLook,
  readServerMutationMask,
  signatureStack,
  signatureStyle,
} from './mutations.ts';

/** A style record the way config/mutation_visuals.json ships one. */
function style(
  id: string,
  ordinal: number,
  overrides: Partial<MutationVisualStyle> = {},
): MutationVisualStyle {
  return {
    id,
    ordinal,
    target: 'foliage',
    pattern: 'none',
    patternScale: 1,
    tint: [1, 1, 1],
    tintStrength: 0,
    variegation: 0,
    variegationColor: [1, 1, 1],
    glow: 0,
    glowColor: [0.2, 0.75, 0.45],
    barkThickness: 1,
    barkDarken: 0,
    spines: 0,
    ...overrides,
  };
}

// The module holds the config table; keep it clean between tests.
function install(...styles: MutationVisualStyle[]): void {
  configureMutationVisuals(styles);
}

install();

test('every node type belongs to an organ family', () => {
  assert.equal(organFamily('root'), 'woody');
  assert.equal(organFamily('radicle'), 'foliage'); // unknown -> visible default
  assert.equal(organFamily('stem'), 'woody');
  assert.equal(organFamily('branch'), 'woody');
  assert.equal(organFamily('trunk'), 'woody');
  assert.equal(organFamily('vine'), 'woody');
  assert.equal(organFamily('leaf'), 'foliage');
  assert.equal(organFamily('cotyledon'), 'foliage');
  assert.equal(organFamily('seed'), 'seed');
  assert.equal(organFamily('flower'), 'bloom');
  assert.equal(organFamily('spore_sac'), 'bloom');
});

test('a mutation is resolved by id first and by ordinal second', () => {
  install(
    style('red_lamina', 4, { tint: [1.2, 0.8, 0.8], tintStrength: 0.8 }),
    style('thick_bark', 2, { target: 'woody', barkThickness: 1.4 }),
  );
  const byId = lookFromMutations([{ id: 'red_lamina', visualSignature: 4 }]).looks.foliage;
  assert.deepEqual(
    byId.tint.map((v) => Number(v.toFixed(3))),
    [1.16, 0.84, 0.84],
  );
  // A rival ships only the ordinal, so that path has to resolve too.
  const byOrdinal = lookFromMutations([{ visualSignature: 2 }]).looks.woody;
  assert.ok(byOrdinal.barkScale > 1);
  assert.equal(mutationVisualStyleCount(), 2);
  assert.equal(mutationStyleById('red_lamina')?.ordinal, 4);
});

test('without a style table the compact wire params still paint the plant', () => {
  configureMutationVisuals([]);
  const look = lookFromMutations([
    { visualSignature: 3, visualParams: [0.4, 0.7, 0.2], visualTarget: 'foliage' },
  ]);
  assert.equal(look.looks.foliage.signature, 3);
  assert.ok(look.looks.foliage.variegation > 0);
  assert.ok(look.looks.foliage.glow > 0);
  assert.equal(look.looks.foliage.pattern, 'mottle');
  install();
});

// C1: only the strongest signature was ever drawn.
test('every held mutation is drawn at once, each on its own organs', () => {
  install(
    style('variegated', 3, { target: 'foliage', pattern: 'mottle', variegation: 0.5 }),
    style('thick_bark', 2, { target: 'woody', barkThickness: 1.35 }),
    style('glow', 1, { target: 'whole', glow: 0.4 }),
  );
  const stack = lookFromMutations([{ id: 'variegated' }, { id: 'thick_bark' }, { id: 'glow' }]);
  // The leaf keeps the mottle and picks up the whole-plant glow...
  assert.equal(stack.looks.foliage.pattern, 'mottle');
  assert.ok(stack.looks.foliage.variegation > 0.3);
  assert.ok(stack.looks.foliage.glow > 0.3);
  // ...and the trunk keeps the bark thickness and the glow, with no mottle.
  assert.ok(stack.looks.woody.barkScale > 1.3);
  assert.equal(stack.looks.woody.variegation, 0);
  assert.ok(stack.looks.woody.glow > 0.3);
  // The strongest ordinal still names the plant.
  assert.equal(stack.signature, 3);
  // One mutation for the whole plant is what a billboard paints.
  assert.ok(stack.disc.glow > 0.3);
  assert.ok(stack.disc.barkScale > 1.3);
});

test('a bark mutation never paints leaves and a lamina mutation never paints wood', () => {
  install(
    style('thick_bark', 2, { target: 'woody', barkThickness: 1.4, barkDarken: 0.1 }),
    style('red_lamina', 4, { target: 'foliage', tint: [1.2, 0.8, 0.8], tintStrength: 0.8 }),
  );
  const stack = lookFromMutations([{ id: 'thick_bark' }, { id: 'red_lamina' }]);
  assert.deepEqual(
    stack.looks.foliage.tint.map((v) => Number(v.toFixed(3))),
    [1.16, 0.84, 0.84],
  );
  assert.equal(stack.looks.foliage.barkScale, 1);
  assert.deepEqual(stack.looks.woody.tint, [1, 1, 1]);
  assert.equal(stack.looks.woody.variegation, 0);
  assert.ok(stack.looks.woody.barkScale > 1);
});

// C4: tints were multiplied unclamped and blew a channel out.
test('stacked tints are clamped into the configured window', () => {
  install(
    style('a', 1, { tint: [1.3, 0.7, 1.0], tintStrength: 0.9 }),
    style('b', 2, { tint: [1.3, 0.7, 1.0], tintStrength: 0.9 }),
    style('c', 3, { tint: [1.3, 0.7, 1.0], tintStrength: 0.9 }),
  );
  const look = lookFromMutations([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).looks.foliage;
  assert.ok(look.tint[0] <= DEFAULT_MUTATION_VISUAL_CAPS.maxTint);
  assert.ok(look.tint[1] >= DEFAULT_MUTATION_VISUAL_CAPS.minTint);
  // Three unclamped 1.27x multipliers would be 2.05.
  assert.ok(look.tint[0] < 1.4);
});

// C7: bark thickness and variegation stacked without a cap.
test('bark thickness, darkening and variegation stop at their ceilings', () => {
  install(
    style('bark_a', 1, { target: 'woody', barkThickness: 1.5, barkDarken: 0.4 }),
    style('bark_b', 2, { target: 'woody', barkThickness: 1.5, barkDarken: 0.4 }),
    style('mottle_a', 3, { variegation: 0.7 }),
    style('mottle_b', 4, { variegation: 0.7 }),
  );
  const stack = lookFromMutations([
    { id: 'bark_a' },
    { id: 'bark_b' },
    { id: 'mottle_a' },
    { id: 'mottle_b' },
  ]);
  const caps = DEFAULT_MUTATION_VISUAL_CAPS;
  assert.equal(stack.looks.woody.barkScale, caps.maxBarkThickness);
  assert.equal(stack.looks.woody.barkDarken, caps.maxBarkDarken);
  assert.equal(stack.looks.foliage.variegation, caps.maxVariegation);
});

test('glow adds up between mutations but is capped', () => {
  install(
    style('glow_a', 1, { target: 'whole', glow: 0.6 }),
    style('glow_b', 2, { target: 'whole', glow: 0.6 }),
  );
  const look = lookFromMutations([{ id: 'glow_a' }, { id: 'glow_b' }]).looks.foliage;
  assert.equal(look.glow, DEFAULT_MUTATION_VISUAL_CAPS.maxGlow);
});

// C6: mutations with `visual_target: none` painted nothing.
test('every organ family can be painted, including the bloom and the seed', () => {
  install(
    style('bloom', 1, { target: 'bloom', tint: [1.1, 0.9, 1.0], tintStrength: 0.5 }),
    style('seed', 2, { target: 'seed', tint: [1.1, 1.0, 0.8], tintStrength: 0.5 }),
  );
  const stack = lookFromMutations([{ id: 'bloom' }, { id: 'seed' }]);
  assert.ok(!lookIsNeutral(stack.looks.bloom));
  assert.ok(!lookIsNeutral(stack.looks.seed));
  // lookAppliesTo is organ-based: the bloom look paints a flower.
  assert.equal(lookAppliesTo(stack.looks.bloom, 'flower'), true);
  assert.equal(lookAppliesTo(stack.looks.bloom, 'leaf'), true); // same tint, different family
  assert.ok(stack.looks.bloom.tint[0] > 1);
  assert.ok(stack.looks.seed.tint[0] > 1);
  assert.ok(stack.looks.seed.tint[2] < 1);
  assert.equal(organLook(stack, 'flower').signature, 2);
});

test('a levelled mutation is visibly stronger, up to the caps', () => {
  install(style('bark', 1, { target: 'woody', barkThickness: 1.2, glow: 0.2 }));
  const one = lookFromMutations([{ id: 'bark', level: 1 }]).looks.woody;
  const two = lookFromMutations([{ id: 'bark', level: 2 }]).looks.woody;
  const three = lookFromMutations([{ id: 'bark', level: 3 }]).looks.woody;
  assert.ok(two.barkScale > one.barkScale);
  assert.ok(three.barkScale >= two.barkScale);
  assert.ok(three.glow > one.glow);
  assert.ok(three.barkScale <= DEFAULT_MUTATION_VISUAL_CAPS.maxBarkThickness);
  // A level 1 style is untouched by the level gain.
  assert.equal(one.barkScale, 1.2);
});

test('the geometry key changes only when a look changes shape', () => {
  install(
    style('bark', 1, { target: 'woody', barkThickness: 1.3 }),
    style('red', 2, { target: 'foliage', tint: [1.2, 0.8, 0.8], tintStrength: 0.5 }),
  );
  const bark = lookFromMutations([{ id: 'bark' }]);
  const barkAgain = lookFromMutations([{ id: 'bark' }]);
  const red = lookFromMutations([{ id: 'red' }]);
  assert.equal(geometryKey(bark), geometryKey(barkAgain));
  assert.notEqual(geometryKey(bark), geometryKey(red));
});

test('an empty mutation set is neutral', () => {
  const stack = lookFromMutations([]);
  assert.equal(stack.signature, 0);
  assert.deepEqual(stack.looks.foliage, NEUTRAL_LOOK);
  assert.deepEqual(stack.disc, NEUTRAL_LOOK);
  assert.equal(lookIsNeutral(NEUTRAL_STACK.looks.woody), true);
  assert.equal(organLook(NEUTRAL_STACK, 'leaf'), NEUTRAL_LOOK);
  assert.equal(lookForOrgans(NEUTRAL_STACK, ['leaf', 'stem']), null);
});

test('lookAppliesTo asks about a look, not about the plant', () => {
  install(style('red', 1, { target: 'foliage', tint: [1.2, 0.8, 0.8], tintStrength: 0.8 }));
  const stack = lookFromMutations([{ id: 'red' }]);
  assert.equal(lookAppliesTo(stack.looks.foliage, 'leaf'), true);
  assert.equal(lookAppliesTo(NEUTRAL_LOOK, 'leaf'), false);
  assert.ok(lookForOrgans(stack, ['stem', 'leaf']) !== null);
});

// The packed vertex word still carries four bits for the billboard tiers.
test('the legacy signature channel never overflows its four bits', () => {
  install(style('one', 1), style('two', 2), style('above_the_mask', 40, { glow: 0.4 }));
  assert.equal(encodeMutationSignature([1]), 1);
  assert.equal(encodeMutationSignature(['two']), 2);
  // An ordinal the word cannot hold reports "none" rather than a wrong colour.
  assert.equal(encodeMutationSignature([40]), 0);
  assert.equal(encodeMutationSignature(['above_the_mask']), 0);
  assert.ok(encodeMutationSignature(['two']) <= MUTATION_MASK_LIMIT);
  assert.equal(nodeMutationMask({ mutationFlags: 0b1_1111 }), 0);
  assert.equal(nodeMutationMask({ mutations: ['two'] }), 2);
  assert.equal(readServerMutationMask({ mutationFlags: 2 }), 2);
  assert.equal(readServerMutationMask({ mutations: ['two'] }), 2);
  assert.equal(mutationMaskHas(2, 2), true);
  assert.equal(mutationMaskHas(2, 1), false);
});

test('a bare signature still resolves to a stack for the billboard tiers', () => {
  install(
    style('red', 4, { target: 'foliage', tint: [1.2, 0.8, 0.8], tintStrength: 0.8 }),
    style('bark', 2, { target: 'woody', barkThickness: 1.3 }),
  );
  const red = signatureStack(4);
  assert.ok(red.looks.foliage.tint[0] > 1);
  // A bark-only signature shows its thickness rather than pretending to be paint.
  const bark = signatureStyle(2);
  assert.ok(bark.barkScale > 1);
  assert.equal(signatureStyle(99).signature, 0);
  assert.deepEqual(signatureStyle(0), NEUTRAL_LOOK);
});
