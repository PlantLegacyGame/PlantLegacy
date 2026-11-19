import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedOrigin } from './originPolicy.ts';

const allowed = ['http://localhost:5173', 'https://play.example.com'];

describe('origin policy', () => {
  it('allows a request with no origin, which is a non-browser client', () => {
    assert.equal(isAllowedOrigin(undefined, allowed, 'production'), true);
  });

  it('allows a configured origin in every environment', () => {
    assert.equal(isAllowedOrigin('https://play.example.com', allowed, 'production'), true);
    assert.equal(isAllowedOrigin('http://localhost:5173', allowed, 'production'), true);
  });

  it('refuses an unlisted origin outside local', () => {
    assert.equal(isAllowedOrigin('https://evil.example', allowed, 'production'), false);
    assert.equal(isAllowedOrigin('https://evil.example', allowed, 'staging'), false);
  });

  it('allows any loopback port locally, and only locally', () => {
    assert.equal(isAllowedOrigin('http://localhost:6000', allowed, 'local'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:6001', allowed, 'local'), true);
    assert.equal(isAllowedOrigin('http://localhost:6000', allowed, 'production'), false);
  });

  it('refuses a malformed origin instead of throwing', () => {
    assert.equal(isAllowedOrigin('not a url', allowed, 'local'), false);
  });
});
