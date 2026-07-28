import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES,
  statesList,
  getStateDataset,
  lgasListForState,
  wardsForLgaInState,
  pollingUnitsForWardInState,
  findPollingUnitInState,
  findWardInState,
  findLgaInState,
  totalPollingUnitsInState,
} from '../src/referenceData/states/index.js';

// CLAUDE.md Phase 4: "parameterize the PU/Ward/LGA reference data per
// state instead of hardcoding Gombe." These tests exist to prove the
// registry genuinely generalizes across states — not just that Gombe
// still works — and that a lookup scoped to one state can never resolve
// data that actually belongs to another.
describe('state reference-data registry', () => {
  it('lists both seeded demo states', () => {
    const codes = statesList().map((s) => s.code);
    assert.ok(codes.includes('GM'));
    assert.ok(codes.includes('AD'));
    assert.strictEqual(codes.length, STATES.length);
  });

  it('getStateDataset resolves a real state and returns null for an unknown one', () => {
    assert.ok(getStateDataset('GM'));
    assert.ok(getStateDataset('AD'));
    assert.strictEqual(getStateDataset('ZZ'), null);
  });

  it('lgasListForState / wardsForLgaInState / pollingUnitsForWardInState are scoped per state', () => {
    const gmLgas = lgasListForState('GM');
    const adLgas = lgasListForState('AD');
    assert.ok(gmLgas.length > 0 && adLgas.length > 0);
    // No shared lgaCodes between the two states' datasets.
    const overlap = gmLgas.filter((l) => adLgas.some((a) => a.lgaCode === l.lgaCode));
    assert.strictEqual(overlap.length, 0);

    const gmWards = wardsForLgaInState('GM', gmLgas[0].lgaCode);
    assert.ok(gmWards.length > 0);
    assert.ok(gmWards.every((w) => w.lgaCode === gmLgas[0].lgaCode));

    const gmPus = pollingUnitsForWardInState('GM', gmWards[0].wardCode);
    assert.ok(gmPus.length > 0);
    assert.ok(gmPus.every((p) => p.wardCode === gmWards[0].wardCode));
  });

  it('findPollingUnitInState never resolves a PU from the wrong state', () => {
    const gmPu = findPollingUnitInState('GM', 'GM-A/W1/001');
    assert.ok(gmPu);
    assert.strictEqual(gmPu.puName, 'Demo PU A1-001');

    // The same code, asked of the other state's dataset, must not resolve
    // — this is the property that makes stateCode-scoped duplicate
    // detection and plausibility lookups in mockServer.js correct.
    assert.strictEqual(findPollingUnitInState('AD', 'GM-A/W1/001'), null);

    const adPu = findPollingUnitInState('AD', 'AD-A/W1/001');
    assert.ok(adPu);
    assert.strictEqual(findPollingUnitInState('GM', 'AD-A/W1/001'), null);
  });

  it('findWardInState / findLgaInState are likewise state-scoped', () => {
    assert.ok(findWardInState('GM', 'GM-A/W1'));
    assert.strictEqual(findWardInState('AD', 'GM-A/W1'), null);
    assert.ok(findLgaInState('GM', 'GM-A'));
    assert.strictEqual(findLgaInState('AD', 'GM-A'), null);
  });

  it('totalPollingUnitsInState matches each state\'s own dataset size, not a combined total', () => {
    const gmTotal = totalPollingUnitsInState('GM');
    const adTotal = totalPollingUnitsInState('AD');
    assert.strictEqual(gmTotal, getStateDataset('GM').POLLING_UNITS.length);
    assert.strictEqual(adTotal, getStateDataset('AD').POLLING_UNITS.length);
    assert.notStrictEqual(gmTotal, gmTotal + adTotal); // sanity: they're genuinely separate counts
  });

  it('an unknown state code degrades to empty results, never throws or leaks another state\'s data', () => {
    assert.deepStrictEqual(lgasListForState('ZZ'), []);
    assert.deepStrictEqual(wardsForLgaInState('ZZ', 'GM-A'), []);
    assert.deepStrictEqual(pollingUnitsForWardInState('ZZ', 'GM-A/W1'), []);
    assert.strictEqual(findPollingUnitInState('ZZ', 'GM-A/W1/001'), null);
    assert.strictEqual(totalPollingUnitsInState('ZZ'), 0);
  });
});
