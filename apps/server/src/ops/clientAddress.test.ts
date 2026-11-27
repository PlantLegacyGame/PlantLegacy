import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientAddress } from './clientAddress.ts';

describe('clientAddress', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    assert.equal(clientAddress('10.0.0.7', '203.0.113.9, 10.0.0.1', false), '10.0.0.7');
  });

  it('uses the first forwarded hop only when the proxy is trusted', () => {
    assert.equal(clientAddress('10.0.0.7', '203.0.113.9, 10.0.0.1', true), '203.0.113.9');
    assert.equal(clientAddress('10.0.0.7', ['198.51.100.4'], true), '198.51.100.4');
  });

  it('falls back to the socket for an empty or blank forwarded header', () => {
    assert.equal(clientAddress('10.0.0.7', '', true), '10.0.0.7');
    assert.equal(clientAddress('10.0.0.7', ' , 10.0.0.1', true), '10.0.0.7');
  });

  it('never returns an empty key', () => {
    assert.equal(clientAddress(undefined, undefined, false), 'unknown');
  });
});
