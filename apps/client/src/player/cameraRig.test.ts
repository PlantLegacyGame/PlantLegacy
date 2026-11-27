import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CameraRigMode, cameraGroundRulesApply, cameraPolarLimit } from './cameraRig.ts';

const CONFIGURED = 3.09;

test('free flight runs none of the ground-follow rules', () => {
  assert.equal(cameraGroundRulesApply('ground'), true);
  assert.equal(cameraGroundRulesApply('free'), false);
});

test('an idle free camera keeps its limit when Root Sight opens', () => {
  const before = cameraPolarLimit('free', false, CONFIGURED);
  const after = cameraPolarLimit('free', true, CONFIGURED);
  assert.equal(before, CONFIGURED);
  assert.equal(after, CONFIGURED);
});

test('the ground rig may uncap the orbit for a deliberate burrow', () => {
  assert.equal(cameraPolarLimit('ground', false, CONFIGURED), CONFIGURED);
  assert.notEqual(cameraPolarLimit('ground', true, CONFIGURED), CONFIGURED);
});

test('the mode type does not collapse free into ground', () => {
  const modes: CameraRigMode[] = ['free', 'ground'];
  assert.deepEqual(modes.map(cameraGroundRulesApply), [false, true]);
});
