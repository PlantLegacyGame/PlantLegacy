import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mouthRadiusFor,
  ROOT_CAVITY_CROWN_CLEARANCE,
  ROOT_CAVITY_MARGIN_RATIO,
  type RootCavityBubble,
  rimModeFor,
  rootCavityShape,
} from './shape.ts';

const bubble = (x: number, y: number, z: number, radius: number): RootCavityBubble => ({
  x,
  y,
  z,
  radius,
});

const shapeOf = (bubbles: RootCavityBubble[], ground?: number[], crownRadiusM?: number) =>
  rootCavityShape({
    bubbles,
    crownX: 0,
    crownZ: 0,
    surfaceY: 20,
    configuredApertureM: 0.6,
    apertureMinM: 0.3,
    crownRadiusM,
    groundHeights: ground,
  });

describe('the cavity is sized by the roots that dug it', () => {
  it('widens past the configured hole once the roots outgrow it', () => {
    const shape = shapeOf([bubble(2, 18, 0, 0.2)]);
    assert.ok(shape.rootsRadiusM >= 2.2 - 1e-9, 'the outermost root was not measured');
    assert.ok(
      Math.abs(shape.apertureM - 2.2 * (1 + ROOT_CAVITY_MARGIN_RATIO)) < 1e-9,
      `aperture ${shape.apertureM}`,
    );
  });

  it('never shrinks below the configured hole', () => {
    // A first radicle barely moves the number: the plant pass exposes roots under
    // the configured radius, and a narrower mouth would leave them outside it.
    assert.equal(shapeOf([bubble(0.05, 19.9, 0, 0.05)]).apertureM, 0.6);
    assert.equal(shapeOf([]).apertureM, 0.6);
  });

  it('scales the margin with the plant, not with a constant', () => {
    const small = shapeOf([bubble(0.5, 19.5, 0, 0.05)]);
    const large = shapeOf([bubble(4, 16, 0, 0.3)]);
    assert.ok(
      large.apertureM - large.rootsRadiusM > small.apertureM - small.rootsRadiusM,
      'a bigger root system got no more dirt around it',
    );
  });

  it('opens wider than a seed whose roots are thinner than its own coat', () => {
    // A radicle is thinner than the seed it leaves. Sized from the roots alone the
    // hole was entirely hidden under the coat, so Root Sight looked like a no-op.
    const seedling = shapeOf([bubble(0.05, 19.9, 0, 0.05)], undefined, 0.5);
    assert.ok(
      seedling.apertureM > 0.5,
      `aperture ${seedling.apertureM} is not wider than the seed coat`,
    );
    assert.equal(seedling.apertureM, 0.5 * ROOT_CAVITY_CROWN_CLEARANCE);
    // A seed radius never narrows the hole below what the roots and config ask for.
    assert.equal(shapeOf([], undefined, 0.1).apertureM, 0.6);
  });

  it('measures depth from the deepest bubble bottom, not its centre', () => {
    const shape = shapeOf([bubble(0, 15, 0, 0.5), bubble(0, 17, 0, 0.25)]);
    assert.ok(Math.abs(shape.rootsDepthM - 5.5) < 1e-9, `depth ${shape.rootsDepthM}`);
  });

  it('opens a mouth that holds the padded bubble of a thin new root', () => {
    // 0.49 m of config floor and the 18% margin make a 0.59 m mouth for a 0.5 m
    // root, but the cavity field pads that root's bubble out to a 0.64 m reach.
    // The bubble then stood outside the hole, the envelope loop rejected it, and
    // the cavity counted zero bubbles: the ground shut while the root grew.
    const thinRoot = [bubble(0.5, 19.8, 0, 0.02)];
    const mouth = mouthRadiusFor(0.49, thinRoot, 0, 0, 0.12);
    assert.ok(Math.abs(mouth - (0.5 + 0.02 + 0.12)) < 1e-9, `mouth ${mouth}`);
    assert.ok(mouth > shapeOf(thinRoot).apertureM - 1e-9);
    // No roots: the configured mouth stands exactly, no phantom padding.
    assert.equal(mouthRadiusFor(0.49, [], 0, 0, 0.12), 0.49);
  });

  it('re-reads the rim for a wider ring than the one sampled', () => {
    // 15 cm of rise is a slope under a 1 m mouth (8 cm allowed) and flat under
    // a 2 m one (16 cm allowed); the same hillside, two mouth sizes.
    assert.equal(rimModeFor([20, 20.15], 1), 'slope');
    assert.equal(rimModeFor([20, 20.15], 2), 'flat');
  });

  it('calls level ground flat and a hillside a slope', () => {
    const flat = shapeOf([bubble(1, 18, 0, 0.2)], [20, 20.02, 19.99, 20.01]);
    assert.equal(flat.rimMode, 'flat');
    const slope = shapeOf([bubble(1, 18, 0, 0.2)], [20, 21.4, 19.2, 20.6]);
    assert.equal(slope.rimMode, 'slope');
  });
});
