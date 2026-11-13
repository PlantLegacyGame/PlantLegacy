/**
 * Client entry flow: the states between opening the page and being in the world.
 *
 * Accounts existed only on the server until now: nothing in the client ever
 * called `/auth/*`, so `accessToken` could never be obtained and "signed-in
 * accounts resume their plant" was unreachable. This machine is the missing
 * client half, kept pure so the transitions can be tested without a DOM.
 */

export type EntryStep =
  | 'booting'
  | 'title'
  | 'sign_in'
  | 'sign_up'
  | 'connecting'
  | 'world'
  | 'plant_lost';

export interface EntryFlowStateMachine {
  step: EntryStep;
  /** True when a stored session exists, so "Continue" is offered. */
  hasSession: boolean;
  /** A request is in flight; forms stay disabled. */
  busy: boolean;
  /** Last auth error, already human-readable. */
  error: string | null;
  /** Why the plant was lost, when the server said. Factual, never consoling. */
  lostReason: string | null;
  displayName: string | null;
  isGuest: boolean;
}

export function createEntryFlowStateMachine(): EntryFlowStateMachine {
  return {
    step: 'booting',
    hasSession: false,
    busy: false,
    error: null,
    lostReason: null,
    displayName: null,
    isGuest: true,
  };
}

/** Boot is finished: show the title, offering Continue only with a stored session. */
export function entryFlowBoot(machine: EntryFlowStateMachine, hasSession: boolean): void {
  machine.step = 'title';
  machine.hasSession = hasSession;
  machine.busy = false;
  machine.error = null;
}

export function entryFlowChoose(machine: EntryFlowStateMachine, step: 'sign_in' | 'sign_up'): void {
  if (machine.step !== 'title') return;
  machine.step = step;
  machine.error = null;
  machine.busy = false;
}

export function entryFlowBack(machine: EntryFlowStateMachine): void {
  if (machine.step !== 'sign_in' && machine.step !== 'sign_up') return;
  machine.step = 'title';
  machine.error = null;
  machine.busy = false;
}

/** A form was submitted: only the auth steps can start a request. */
export function entryFlowBeginRequest(machine: EntryFlowStateMachine): boolean {
  if (machine.step !== 'sign_in' && machine.step !== 'sign_up') return false;
  if (machine.busy) return false;
  machine.busy = true;
  machine.error = null;
  return true;
}

export function entryFlowRequestFailed(machine: EntryFlowStateMachine, message: string): void {
  machine.busy = false;
  machine.error = message;
}

/** Tokens obtained: go to the socket. */
export function entryFlowAuthenticated(
  machine: EntryFlowStateMachine,
  displayName: string | null,
): void {
  machine.step = 'connecting';
  machine.busy = false;
  machine.error = null;
  machine.displayName = displayName;
  machine.isGuest = false;
  machine.hasSession = true;
}

export function entryFlowContinueAsGuest(machine: EntryFlowStateMachine): void {
  if (machine.step !== 'title') return;
  machine.step = 'connecting';
  machine.busy = false;
  machine.error = null;
  machine.isGuest = true;
}

/** The server welcomed us: the overlay can go away. */
export function entryFlowWorldReady(machine: EntryFlowStateMachine): void {
  machine.step = 'world';
  machine.busy = false;
  machine.error = null;
  machine.lostReason = null;
}

export function entryFlowConnectionFailed(machine: EntryFlowStateMachine, message: string): void {
  machine.step = 'title';
  machine.busy = false;
  machine.error = message;
}

/** Our plant died or was removed with no reclaim: offer to plant a new seed. */
export function entryFlowPlantLost(
  machine: EntryFlowStateMachine,
  reason: string | null = null,
): void {
  machine.step = 'plant_lost';
  machine.busy = false;
  machine.error = null;
  machine.lostReason = reason;
}

/** Reconnecting after a loss: same "connecting" screen as the first join. */
export function entryFlowReseed(machine: EntryFlowStateMachine): void {
  if (machine.step !== 'plant_lost') return;
  machine.step = 'connecting';
  machine.busy = false;
  machine.error = null;
  machine.lostReason = null;
}

/** Signing out returns to the title without a session. */
export function entryFlowSignedOut(machine: EntryFlowStateMachine): void {
  machine.step = 'title';
  machine.hasSession = false;
  machine.busy = false;
  machine.error = null;
  machine.displayName = null;
  machine.isGuest = true;
}
