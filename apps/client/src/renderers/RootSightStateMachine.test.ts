import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  createRootSightStateMachine,
  rootSightStateMachineIsEnabled,
  rootSightStateMachineSetContext,
  rootSightStateMachineSetTarget,
  rootSightStateMachineToggle,
  rootSightStateMachineUpdate,
} from './RootSightStateMachine.ts';

const CONFIG = {
  transitionMs: 1000,
  cutawayRadius: 5,
  soilOpacity: 0.6,
  cameraTarget: 'own_plant' as const,
};

describe('RootSightStateMachine', () => {
  it('toggles from surface into the underground transition and settles there', () => {
    const machine = createRootSightStateMachine(CONFIG);
    assert.equal(machine.state, 'surface');
    assert.equal(rootSightStateMachineIsEnabled(machine), false);

    rootSightStateMachineToggle(machine);
    assert.equal(machine.state, 'transitioning_to_underground');
    assert.equal(rootSightStateMachineIsEnabled(machine), true);

    rootSightStateMachineUpdate(machine, 0.5);
    assert.ok(machine.progress > 0 && machine.progress < 1, 'halfway through the transition');

    rootSightStateMachineUpdate(machine, 0.6);
    assert.equal(machine.state, 'underground');
    assert.equal(machine.progress, 1);
  });

  it('reverses mid-transition without overshooting', () => {
    const machine = createRootSightStateMachine(CONFIG);
    rootSightStateMachineToggle(machine);
    rootSightStateMachineUpdate(machine, 0.4);

    rootSightStateMachineToggle(machine);
    assert.equal(machine.target, 'surface');

    rootSightStateMachineUpdate(machine, 0.4);
    assert.equal(machine.state, 'surface');
    assert.equal(machine.progress, 0);
  });

  it('snaps immediately when the transition duration is zero', () => {
    const machine = createRootSightStateMachine({ ...CONFIG, transitionMs: 0 });
    rootSightStateMachineToggle(machine);
    rootSightStateMachineUpdate(machine, 0);
    assert.equal(machine.state, 'underground');
    assert.equal(machine.progress, 1);
  });

  it('aims the camera at the plant, or at the camera when configured to', () => {
    const machine = createRootSightStateMachine(CONFIG);
    rootSightStateMachineSetContext(machine, {
      ownPlantPosition: new THREE.Vector3(1, 2, 3),
      cameraPosition: new THREE.Vector3(9, 9, 9),
      cameraTarget: new THREE.Vector3(4, 4, 4),
    });
    const plantAim = rootSightStateMachineUpdate(machine, 0.1);
    assert.deepEqual(plantAim.targetPosition.toArray(), [1, 2, 3]);

    const cameraMachine = createRootSightStateMachine({
      ...CONFIG,
      cameraTarget: 'camera_position',
    });
    rootSightStateMachineSetContext(cameraMachine, {
      ownPlantPosition: new THREE.Vector3(1, 2, 3),
      cameraPosition: new THREE.Vector3(9, 9, 9),
      cameraTarget: new THREE.Vector3(4, 4, 4),
    });
    const cameraAim = rootSightStateMachineUpdate(cameraMachine, 0.1);
    assert.deepEqual(cameraAim.targetPosition.toArray(), [9, 9, 9]);
  });

  it('setTarget does not restart a transition that is already running', () => {
    const machine = createRootSightStateMachine(CONFIG);
    rootSightStateMachineToggle(machine);
    rootSightStateMachineUpdate(machine, 0.5);
    const progress = machine.progress;

    rootSightStateMachineSetTarget(machine, 'underground');
    assert.equal(machine.state, 'transitioning_to_underground');
    assert.equal(machine.progress, progress, 'progress must not be reset');
  });
});
