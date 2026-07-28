// PLACEHOLDER / SAMPLE REFERENCE DATA — NOT REAL ELECTORAL GEOGRAPHY.
// See ./gombe.js for the full explanation of what this file is and isn't.
// Adamawa is one of the five states CLAUDE.md names for the North-East
// expansion ("Adamawa, Bauchi, Borno, Taraba, Yobe") — this exists to
// prove referenceData/index.js's registry genuinely generalizes beyond a
// single hardcoded state, not to represent real Adamawa geography.

export const REFERENCE_DATA_VERSION = 'sample-2026-07-28';

export const LGAS = [
  { lgaCode: 'AD-A', lgaName: 'Demo LGA A' },
  { lgaCode: 'AD-B', lgaName: 'Demo LGA B' },
];

export const WARDS = [
  { wardCode: 'AD-A/W1', lgaCode: 'AD-A', wardName: 'Demo Ward A1' },
  { wardCode: 'AD-A/W2', lgaCode: 'AD-A', wardName: 'Demo Ward A2' },
  { wardCode: 'AD-B/W1', lgaCode: 'AD-B', wardName: 'Demo Ward B1' },
];

export const POLLING_UNITS = [
  { puCode: 'AD-A/W1/001', wardCode: 'AD-A/W1', puName: 'Demo PU A1-001', registeredVoters: 388 },
  { puCode: 'AD-A/W1/002', wardCode: 'AD-A/W1', puName: 'Demo PU A1-002', registeredVoters: 421 },
  { puCode: 'AD-A/W2/001', wardCode: 'AD-A/W2', puName: 'Demo PU A2-001', registeredVoters: 296 },
  { puCode: 'AD-B/W1/001', wardCode: 'AD-B/W1', puName: 'Demo PU B1-001', registeredVoters: 344 },
  { puCode: 'AD-B/W1/002', wardCode: 'AD-B/W1', puName: 'Demo PU B1-002', registeredVoters: 407 },
];

export function lgasList() {
  return LGAS;
}

export function wardsForLga(lgaCode) {
  return WARDS.filter((w) => w.lgaCode === lgaCode);
}

export function pollingUnitsForWard(wardCode) {
  return POLLING_UNITS.filter((p) => p.wardCode === wardCode);
}

export function findPollingUnit(puCode) {
  return POLLING_UNITS.find((p) => p.puCode === puCode);
}

export function findWard(wardCode) {
  return WARDS.find((w) => w.wardCode === wardCode);
}

export function findLga(lgaCode) {
  return LGAS.find((l) => l.lgaCode === lgaCode);
}
