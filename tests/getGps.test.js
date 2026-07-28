import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getGps } from '../src/geo/getGps.js';

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

// Node 24 defines a built-in `navigator` global as getter-only, so a plain
// `globalThis.navigator = ...` throws. Object.defineProperty overrides it.
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalDescriptor);
  }
});

describe('getGps', () => {
  it('resolves null when geolocation is unavailable, rather than throwing', async () => {
    setNavigator({});
    const result = await getGps({ timeoutMs: 100 });
    assert.strictEqual(result, null);
  });

  it('resolves coordinates on a successful fix', async () => {
    setNavigator({
      geolocation: {
        getCurrentPosition: (success) => {
          success({ coords: { latitude: 10.29, longitude: 11.17, accuracy: 12 } });
        },
      },
    });
    const result = await getGps({ timeoutMs: 100 });
    assert.deepStrictEqual(result, { lat: 10.29, lng: 11.17, accuracy: 12 });
  });

  it('resolves null (not a rejection) when the browser reports an error', async () => {
    setNavigator({
      geolocation: {
        getCurrentPosition: (_success, error) => {
          error(new Error('permission denied'));
        },
      },
    });
    const result = await getGps({ timeoutMs: 100 });
    assert.strictEqual(result, null);
  });

  it('resolves null if neither callback fires before the timeout, and never hangs capture', async () => {
    setNavigator({
      geolocation: {
        getCurrentPosition: () => {
          /* simulates a stalled fix: never calls back */
        },
      },
    });
    const result = await getGps({ timeoutMs: 50 });
    assert.strictEqual(result, null);
  });
});
