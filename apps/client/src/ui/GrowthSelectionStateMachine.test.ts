import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createGrowthSelectionStateMachine,
  growthSelectionStateMachineCancelDrawing,
  growthSelectionStateMachineConfirmDrawing,
  growthSelectionStateMachineHide,
  growthSelectionStateMachineRenderOptions,
  growthSelectionStateMachineRequestOptions,
  growthSelectionStateMachineSelectOption,
  growthSelectionStateMachineStartDrawing,
  growthSelectionStateMachineUpdateDrawing,
} from './GrowthSelectionStateMachine.ts';

const OPTION = {
  type: 'stem',
  label: 'Stem',
  energyCost: 4,
  biomassGain: 2,
  expectedSeconds: 6,
  available: true,
};

function openOptions(nodeId = 'node_1') {
  const machine = createGrowthSelectionStateMachine();
  growthSelectionStateMachineRequestOptions(machine, nodeId);
  growthSelectionStateMachineRenderOptions(machine, {
    nodeId,
    options: [OPTION],
    conditions: null,
    isSeed: false,
    nodeType: 'root',
    biomass: 10,
    energy: 20,
  });
  return machine;
}

describe('GrowthSelectionStateMachine', () => {
  it('shows options after a request and ignores a result for a superseded request', () => {
    const machine = createGrowthSelectionStateMachine();
    growthSelectionStateMachineRequestOptions(machine, 'node_1');
    assert.equal(machine.state, 'loading');
    assert.equal(machine.visible, true);

    growthSelectionStateMachineRenderOptions(machine, {
      nodeId: 'node_1',
      options: [OPTION],
      conditions: null,
      isSeed: false,
      nodeType: 'root',
      biomass: 10,
      energy: 20,
    });
    assert.equal(machine.state, 'options_visible');
    assert.equal(machine.options.length, 1);
    assert.equal(machine.loading, false);
  });

  it('ignores an option result when nothing is loading', () => {
    const machine = createGrowthSelectionStateMachine();
    growthSelectionStateMachineRenderOptions(machine, {
      nodeId: 'node_1',
      options: [OPTION],
      conditions: null,
      isSeed: false,
      nodeType: 'root',
      biomass: 1,
      energy: 1,
    });
    assert.equal(machine.state, 'hidden', 'a stale result must not open the panel');
    assert.equal(machine.options.length, 0);
  });

  it('accepts a second request while a panel is open, but not while loading', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineRequestOptions(machine, 'node_2');
    assert.equal(machine.selectedNodeId, 'node_2');
    assert.equal(machine.state, 'loading');

    // A request during loading must not replace the node being loaded.
    growthSelectionStateMachineRequestOptions(machine, 'node_3');
    assert.equal(machine.selectedNodeId, 'node_2');
  });

  it('draws a path, normalises the direction and confirms an intent', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineStartDrawing(
      machine,
      'node_1',
      { x: 0, y: 0, z: 0 },
      'stem',
      'Stem',
    );
    assert.equal(machine.state, 'drawing');
    assert(machine.drawingData);

    growthSelectionStateMachineUpdateDrawing(
      machine,
      { x: 0, y: 2, z: 0 },
      { isValid: true, distance: 2 },
    );
    const data = machine.drawingData;
    assert(data);
    assert.equal(data.isValid, true);
    assert.ok(data.direction);
    assert.equal(Math.round(data.direction.y), 1, 'direction must be unit length and upward');
    assert.ok(
      Math.abs(Math.hypot(data.direction.x, data.direction.y, data.direction.z) - 1) < 1e-9,
    );

    const intent = growthSelectionStateMachineConfirmDrawing(machine);
    assert(intent);
    assert.equal(intent.nodeId, 'node_1');
    assert.equal(intent.optionType, 'stem');
    assert.equal(machine.state, 'options_visible');
    assert.equal(machine.drawingData, null);
  });

  it('refuses to confirm an invalid drawing', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineStartDrawing(
      machine,
      'node_1',
      { x: 0, y: 0, z: 0 },
      'stem',
      'Stem',
    );
    growthSelectionStateMachineUpdateDrawing(
      machine,
      { x: 0, y: 0.01, z: 0 },
      { isValid: false, reason: 'too short', distance: 0.01 },
    );
    assert.equal(growthSelectionStateMachineConfirmDrawing(machine), null);
    assert.equal(machine.state, 'drawing', 'an invalid drawing stays in the drawing state');
  });

  it('never starts drawing for a different node than the one selected', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineStartDrawing(
      machine,
      'node_9',
      { x: 0, y: 0, z: 0 },
      'stem',
      'Stem',
    );
    assert.equal(machine.state, 'options_visible');
    assert.equal(machine.drawingData, null);
  });

  it('caps the traced path so a long drag cannot grow it without bound', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineStartDrawing(
      machine,
      'node_1',
      { x: 0, y: 0, z: 0 },
      'stem',
      'Stem',
    );
    for (let i = 1; i <= 600; i++) {
      growthSelectionStateMachineUpdateDrawing(
        machine,
        { x: i * 0.1, y: 0, z: 0 },
        { isValid: true, distance: i * 0.1 },
      );
    }
    assert(machine.drawingData);
    assert.ok(machine.drawingData.path.length <= 256);
  });

  it('cancels a drawing back to the options and hides everything on hide', () => {
    const machine = openOptions('node_1');
    growthSelectionStateMachineSelectOption(machine, 'stem', 'Stem');
    assert.equal(machine.state, 'option_selected');

    growthSelectionStateMachineStartDrawing(
      machine,
      'node_1',
      { x: 0, y: 0, z: 0 },
      'stem',
      'Stem',
    );
    growthSelectionStateMachineCancelDrawing(machine);
    assert.equal(machine.state, 'options_visible');
    assert.equal(machine.drawingData, null);

    growthSelectionStateMachineHide(machine);
    assert.equal(machine.state, 'hidden');
    assert.equal(machine.visible, false);
    assert.equal(machine.selectedNodeId, null);
    assert.equal(machine.selectedOptionType, null);
  });
});
