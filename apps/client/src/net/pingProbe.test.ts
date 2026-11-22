import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closePingProbe, openPingProbe } from './pingProbe.ts';

describe('the connection probe', () => {
  it('times a pong from the send that asked for it', () => {
    const probe = openPingProbe(null, 1_000, 12_000);
    assert.equal(probe.stalled, false);
    assert.equal(closePingProbe(probe.sentAt, 1_012), 12);
  });

  it('starts a fresh probe on every send, so a lost one cannot inflate the next', () => {
    // The bug: a probe that never answered kept its timestamp, and the pong for
    // the *next* probe was measured from it - 5 s of interval reported as ping.
    const first = openPingProbe(null, 1_000, 12_000);
    const second = openPingProbe(first.sentAt, 6_000, 12_000);
    assert.equal(second.stalled, false, 'a five-second-old probe is not a stall yet');
    assert.equal(second.sentAt, 6_000, 'the clock restarts with the new send');
    assert.equal(closePingProbe(second.sentAt, 6_004), 4);
  });

  it('calls a probe that outlived the stall window stalled', () => {
    const probe = openPingProbe(1_000, 14_000, 12_000);
    assert.equal(probe.stalled, true);
    assert.equal(probe.sentAt, 14_000);
  });

  it('has no round trip when nothing was pending, or the clock went backwards', () => {
    assert.equal(closePingProbe(null, 5_000), null);
    assert.equal(closePingProbe(5_000, 4_000), null);
    assert.equal(closePingProbe(Number.NaN, 5_000), null);
  });
});
