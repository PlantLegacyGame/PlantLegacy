import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatElapsed,
  nodeHealthLabel,
  nodeHealthStatus,
  plantHealthLabel,
  plantHealthStatus,
} from './plantHealth.ts';

describe('plant health wording', () => {
  it('maps structural fractions to statuses', () => {
    assert.equal(plantHealthStatus(1), 'healthy');
    assert.equal(plantHealthStatus(0.75), 'healthy');
    assert.equal(plantHealthStatus(0.74), 'stressed');
    assert.equal(plantHealthStatus(0.5), 'stressed');
    assert.equal(plantHealthStatus(0.49), 'withering');
    assert.equal(plantHealthStatus(0.25), 'withering');
    assert.equal(plantHealthStatus(0.24), 'dying');
    assert.equal(plantHealthStatus(0.001), 'dying');
    assert.equal(plantHealthStatus(0), 'dead');
  });

  it('does not call a plant dying when the server has no structure yet', () => {
    assert.equal(plantHealthStatus(Number.NaN), 'healthy');
    assert.equal(plantHealthLabel('healthy'), 'Healthy');
    assert.equal(plantHealthLabel('dying'), 'Dying');
  });

  it('honours custom thresholds', () => {
    const thresholds = { healthy: 0.9, stressed: 0.6, withering: 0.3 };
    assert.equal(plantHealthStatus(0.8, thresholds), 'stressed');
    assert.equal(plantHealthStatus(0.55, thresholds), 'withering');
    assert.equal(plantHealthStatus(0.29, thresholds), 'dying');
  });

  it('describes node health from biomass and growth progress', () => {
    assert.equal(nodeHealthStatus(0, 1), 'gone');
    assert.equal(nodeHealthStatus(0.2, 0.4), 'growing');
    assert.equal(nodeHealthStatus(0.8, 1), 'intact');
    assert.equal(nodeHealthStatus(0.5, 1), 'fading');
    assert.equal(nodeHealthStatus(0.2, 1), 'depleted');
    assert.equal(nodeHealthLabel('fading'), 'Fading');
  });

  it('formats elapsed time compactly', () => {
    assert.equal(formatElapsed(0), '0s');
    assert.equal(formatElapsed(65), '1m 05s');
    assert.equal(formatElapsed(3725), '1h 02m');
    assert.equal(formatElapsed(Number.NaN), '0s');
  });
});
