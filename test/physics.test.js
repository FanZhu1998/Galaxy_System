import test from 'node:test';
import assert from 'node:assert/strict';
import { TAU, circularSpeed, angularRate, solveKepler } from '../src/physics.js';
import { systems } from '../src/systems.js';

test('galactic orbit at 8 kpc preserves the original model reference values', () => {
  assert.ok(Math.abs(circularSpeed(8) - 200.9) < 0.1);
  assert.ok(Math.abs(TAU / angularRate(8) - 244.6) < 0.1);
});

test('every configured planet satisfies Kepler equation throughout its orbit', () => {
  for (const system of systems) {
    assert.ok(system.mass > 0);
    for (const [, semimajorAxis, eccentricity] of system.planets) {
      assert.ok(semimajorAxis > 0 && eccentricity >= 0 && eccentricity < 1);
      for (let step = 0; step <= 32; step++) {
        const mean = step / 32 * TAU;
        const eccentric = solveKepler(mean, eccentricity);
        assert.ok(Math.abs(eccentric - eccentricity * Math.sin(eccentric) - mean) < 1e-10);
      }
    }
  }
});
