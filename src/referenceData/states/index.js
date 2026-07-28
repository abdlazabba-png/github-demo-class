import * as gombe from './gombe.js';
import * as adamawa from './adamawa.js';

// Registry of per-state PU/Ward/LGA datasets (CLAUDE.md Phase 4:
// "parameterize the PU/Ward/LGA reference data per state instead of
// hardcoding Gombe"). Every module in ./ exports the same shape
// (LGAS/WARDS/POLLING_UNITS + lookup helpers) so they're interchangeable
// here — adding a new state means adding one file + one line below, not
// touching CaptureForm, the dashboard, or mockServer.
export const STATES = [
  { code: 'GM', name: 'Gombe', dataset: gombe },
  { code: 'AD', name: 'Adamawa', dataset: adamawa },
];

export function statesList() {
  return STATES.map(({ code, name }) => ({ code, name }));
}

export function getStateDataset(stateCode) {
  const state = STATES.find((s) => s.code === stateCode);
  if (!state) return null;
  return state.dataset;
}

export function lgasListForState(stateCode) {
  return getStateDataset(stateCode)?.lgasList() ?? [];
}

export function wardsForLgaInState(stateCode, lgaCode) {
  return getStateDataset(stateCode)?.wardsForLga(lgaCode) ?? [];
}

export function pollingUnitsForWardInState(stateCode, wardCode) {
  return getStateDataset(stateCode)?.pollingUnitsForWard(wardCode) ?? [];
}

// Deliberately requires stateCode rather than searching every state's PU
// list for a match: PU codes are only namespaced by convention (GM-…,
// AD-…), not guaranteed unique, so "search everywhere" would be the kind
// of implicit cross-state assumption Phase 4 exists to remove.
export function findPollingUnitInState(stateCode, puCode) {
  return getStateDataset(stateCode)?.findPollingUnit(puCode) ?? null;
}

export function findWardInState(stateCode, wardCode) {
  return getStateDataset(stateCode)?.findWard(wardCode) ?? null;
}

export function findLgaInState(stateCode, lgaCode) {
  return getStateDataset(stateCode)?.findLga(lgaCode) ?? null;
}

export function totalPollingUnitsInState(stateCode) {
  return getStateDataset(stateCode)?.POLLING_UNITS.length ?? 0;
}
