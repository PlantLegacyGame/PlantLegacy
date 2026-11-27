import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEntryFlowStateMachine,
  entryFlowAuthenticated,
  entryFlowBack,
  entryFlowBeginRequest,
  entryFlowBoot,
  entryFlowCancelSpawn,
  entryFlowChoose,
  entryFlowChooseSpawn,
  entryFlowConnectionFailed,
  entryFlowContinueAsGuest,
  entryFlowPlantLost,
  entryFlowRequestFailed,
  entryFlowReseed,
  entryFlowSignedOut,
  entryFlowSpawnConfirmed,
  entryFlowWorldReady,
} from './EntryFlowStateMachine.ts';

describe('EntryFlowStateMachine', () => {
  it('boots to the title and only offers Continue with a stored session', () => {
    const machine = createEntryFlowStateMachine();
    assert.equal(machine.step, 'booting');

    entryFlowBoot(machine, false);
    assert.equal(machine.step, 'title');
    assert.equal(machine.hasSession, false);

    entryFlowBoot(machine, true);
    assert.equal(machine.hasSession, true);
  });

  it('moves between the title and the auth forms, clearing errors on the way', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);

    entryFlowChoose(machine, 'sign_up');
    assert.equal(machine.step, 'sign_up');

    entryFlowBack(machine);
    assert.equal(machine.step, 'title');

    entryFlowChoose(machine, 'sign_in');
    entryFlowBeginRequest(machine);
    entryFlowRequestFailed(machine, 'invalid_credentials');
    assert.equal(machine.error, 'invalid_credentials');
    assert.equal(machine.busy, false);

    entryFlowBack(machine);
    assert.equal(machine.error, null, 'leaving the form clears its error');
  });

  it('ignores form actions outside the auth steps', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);

    assert.equal(entryFlowBeginRequest(machine), false);
    entryFlowChoose(machine, 'sign_in');
    assert.equal(entryFlowBeginRequest(machine), true);
    assert.equal(entryFlowBeginRequest(machine), false, 'a second submit while busy is ignored');

    entryFlowBack(machine);
    entryFlowChoose(machine, 'sign_in');
    entryFlowBeginRequest(machine);
    entryFlowAuthenticated(machine, 'Fern');
    assert.equal(machine.busy, false, 'success must clear the busy flag');
  });

  it('goes from a successful auth straight to connecting and then the world', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);
    entryFlowChoose(machine, 'sign_in');
    entryFlowBeginRequest(machine);
    entryFlowAuthenticated(machine, 'Fern');

    assert.equal(machine.step, 'connecting');
    assert.equal(machine.isGuest, false);
    assert.equal(machine.hasSession, true);
    assert.equal(machine.displayName, 'Fern');

    entryFlowWorldReady(machine);
    assert.equal(machine.step, 'world');
  });

  it('treats a guest as a guest and keeps the stored session flag alone', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);
    entryFlowContinueAsGuest(machine);

    assert.equal(machine.step, 'connecting');
    assert.equal(machine.isGuest, true);
    assert.equal(machine.hasSession, false);

    // A guest cannot start auth requests from the connecting screen.
    assert.equal(entryFlowBeginRequest(machine), false);
  });

  it('returns to the title with an error when the connection fails', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, true);
    entryFlowContinueAsGuest(machine);
    entryFlowConnectionFailed(machine, 'server_unreachable');

    assert.equal(machine.step, 'title');
    assert.equal(machine.error, 'server_unreachable');
    assert.equal(machine.busy, false);
  });

  it('offers a new seed after the plant is lost, and reseeds from there', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, true);
    entryFlowWorldReady(machine);

    entryFlowPlantLost(machine);
    assert.equal(machine.step, 'plant_lost');

    entryFlowReseed(machine);
    assert.equal(machine.step, 'spawn');

    entryFlowSpawnConfirmed(machine);
    assert.equal(machine.step, 'connecting');
  });

  it('keeps death stats for the lost screen and clears them on the next seed', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, true);
    entryFlowWorldReady(machine);

    const stats = {
      healthFraction: 0,
      biomass: 0,
      biomassRatePerSecond: null,
      peakBiomass: 12.5,
      energy: 0,
      storedWater: 0,
      waterCapacity: 40,
      storedMinerals: 0,
      mineralCapacity: 10,
      nodeCount: 0,
      peakNodeCount: 4,
      mutationCount: 0,
      mutationUpkeepPerSecond: 0,
      ageSeconds: 120,
      dayNumber: 2,
      clock: '07:30',
    };
    entryFlowPlantLost(machine, 'Dried out', { cause: 'dehydration', stats });
    assert.equal(machine.lostStats?.cause, 'dehydration');
    assert.equal(machine.lostStats?.stats.peakBiomass, 12.5);

    entryFlowReseed(machine);
    assert.equal(machine.lostStats, null);
  });

  it('opens the seed scene from the title, and cancelling returns there', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);

    assert.equal(entryFlowChooseSpawn(machine), true);
    assert.equal(machine.step, 'spawn');
    entryFlowCancelSpawn(machine);
    assert.equal(machine.step, 'title');

    entryFlowContinueAsGuest(machine);
    assert.equal(entryFlowChooseSpawn(machine), false, 'connecting cannot reopen the scene');
  });

  it('only confirms a seed from the spawn step', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);
    entryFlowSpawnConfirmed(machine);
    assert.equal(machine.step, 'title');

    entryFlowChooseSpawn(machine);
    entryFlowSpawnConfirmed(machine);
    assert.equal(machine.step, 'connecting');
  });

  it('signing out forgets the session identity', () => {
    const machine = createEntryFlowStateMachine();
    entryFlowBoot(machine, false);
    entryFlowChoose(machine, 'sign_in');
    entryFlowBeginRequest(machine);
    entryFlowAuthenticated(machine, 'Fern');
    entryFlowWorldReady(machine);

    entryFlowSignedOut(machine);
    assert.equal(machine.step, 'title');
    assert.equal(machine.hasSession, false);
    assert.equal(machine.displayName, null);
    assert.equal(machine.isGuest, true);
  });
});
