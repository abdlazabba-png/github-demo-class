import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LGAS,
  WARDS,
  POLLING_UNITS,
  lgasList,
  wardsForLga,
  pollingUnitsForWard,
  findPollingUnit,
  findWard,
  findLga,
} from '../src/referenceData/states/gombe.js';

describe('reference data hierarchy', () => {
  it('every ward points at a real LGA', () => {
    for (const ward of WARDS) {
      assert.ok(LGAS.some((l) => l.lgaCode === ward.lgaCode), `orphan ward ${ward.wardCode}`);
    }
  });

  it('every polling unit points at a real ward', () => {
    for (const pu of POLLING_UNITS) {
      assert.ok(WARDS.some((w) => w.wardCode === pu.wardCode), `orphan PU ${pu.puCode}`);
    }
  });

  it('lgasList returns all LGAs', () => {
    assert.deepStrictEqual(lgasList(), LGAS);
  });

  it('wardsForLga scopes correctly and excludes other LGAs', () => {
    const wards = wardsForLga('GM-A');
    assert.ok(wards.length > 0);
    assert.ok(wards.every((w) => w.lgaCode === 'GM-A'));
  });

  it('pollingUnitsForWard scopes correctly and excludes other wards', () => {
    const pus = pollingUnitsForWard('GM-A/W1');
    assert.ok(pus.length > 0);
    assert.ok(pus.every((p) => p.wardCode === 'GM-A/W1'));
  });

  it('findPollingUnit / findWard / findLga return the right record', () => {
    const pu = findPollingUnit('GM-A/W1/001');
    assert.strictEqual(pu.puName, 'Demo PU A1-001');
    assert.strictEqual(typeof pu.registeredVoters, 'number');

    assert.strictEqual(findWard('GM-A/W1').wardName, 'Demo Ward A1');
    assert.strictEqual(findLga('GM-A').lgaName, 'Demo LGA A');
  });

  it('unknown codes resolve to undefined rather than throwing', () => {
    assert.strictEqual(findPollingUnit('nope'), undefined);
    assert.deepStrictEqual(wardsForLga('nope'), []);
    assert.deepStrictEqual(pollingUnitsForWard('nope'), []);
  });
});
