import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createStyleVarWriter } from './styleVars.ts';

/** The smallest thing that answers like an element's style declaration. */
function fakeTarget() {
  const written: Array<[string, string]> = [];
  const target = {
    style: {
      setProperty(name: string, value: string) {
        written.push([name, value]);
      },
    },
  } as unknown as HTMLElement;
  return { target, written };
}

describe('style variable writer', () => {
  it('writes a value the first time', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target);
    vars.set('--pl-sky', '#123456');
    assert.deepEqual(written, [['--pl-sky', '#123456']]);
  });

  it('does not write the same value twice', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target);
    vars.set('--pl-sky', '#123456');
    vars.set('--pl-sky', '#123456');
    vars.set('--pl-sky', '#123456');
    assert.equal(written.length, 1);
  });

  it('writes again when the value moves, and per property', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target);
    vars.set('--pl-sky', '#123456');
    vars.set('--pl-hill', '#654321');
    vars.set('--pl-sky', '#123457');
    assert.deepEqual(written, [
      ['--pl-sky', '#123456'],
      ['--pl-hill', '#654321'],
      ['--pl-sky', '#123457'],
    ]);
  });

  it('writes everything again after a reset', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target);
    vars.set('--pl-sky', '#123456');
    vars.reset();
    vars.set('--pl-sky', '#123456');
    assert.equal(written.length, 2);
  });

  it('skips a colour step below its tolerance, and takes it once it adds up', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target, { colourTolerance: 2 });
    vars.set('--pl-sky', '#123456');
    vars.set('--pl-sky', '#123457');
    vars.set('--pl-sky', '#123458');
    assert.equal(written.length, 1);
    vars.set('--pl-sky', '#123459');
    assert.deepEqual(written, [
      ['--pl-sky', '#123456'],
      ['--pl-sky', '#123459'],
    ]);
  });

  it('compares every channel, and leaves non-hex values exact', () => {
    const { target, written } = fakeTarget();
    const vars = createStyleVarWriter(target, { colourTolerance: 2 });
    vars.set('--pl-sky', '#123456');
    vars.set('--pl-sky', '#153456');
    vars.set('--pl-glow', '0.5');
    vars.set('--pl-glow', '0.51');
    assert.deepEqual(written, [
      ['--pl-sky', '#123456'],
      ['--pl-sky', '#153456'],
      ['--pl-glow', '0.5'],
      ['--pl-glow', '0.51'],
    ]);
  });
});
