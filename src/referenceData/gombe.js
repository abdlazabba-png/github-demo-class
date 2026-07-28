// PLACEHOLDER / SAMPLE REFERENCE DATA — NOT REAL ELECTORAL GEOGRAPHY.
//
// CLAUDE.md calls for the real PU/Ward/LGA hierarchy + registered-voter
// counts (~2,988 polling units for the Gombe pilot) to be bundled
// client-side so agents can select their PU with zero network. That real
// dataset has to come from an authoritative state/INEC source — this file
// is a small synthetic stand-in with deliberately generic names ("Demo LGA
// A"...) so nobody mistakes it for the genuine article. Swap this file for
// the real per-state dataset before any pilot or real submission; the
// shape (LGAS/WARDS/POLLING_UNITS + the lookup helpers below) is what the
// rest of the app depends on, not the specific rows.

export const REFERENCE_DATA_VERSION = 'sample-2026-07-28';

export const LGAS = [
  { lgaCode: 'GM-A', lgaName: 'Demo LGA A' },
  { lgaCode: 'GM-B', lgaName: 'Demo LGA B' },
];

export const WARDS = [
  { wardCode: 'GM-A/W1', lgaCode: 'GM-A', wardName: 'Demo Ward A1' },
  { wardCode: 'GM-A/W2', lgaCode: 'GM-A', wardName: 'Demo Ward A2' },
  { wardCode: 'GM-B/W1', lgaCode: 'GM-B', wardName: 'Demo Ward B1' },
  { wardCode: 'GM-B/W2', lgaCode: 'GM-B', wardName: 'Demo Ward B2' },
];

export const POLLING_UNITS = [
  { puCode: 'GM-A/W1/001', wardCode: 'GM-A/W1', puName: 'Demo PU A1-001', registeredVoters: 412 },
  { puCode: 'GM-A/W1/002', wardCode: 'GM-A/W1', puName: 'Demo PU A1-002', registeredVoters: 355 },
  { puCode: 'GM-A/W1/003', wardCode: 'GM-A/W1', puName: 'Demo PU A1-003', registeredVoters: 289 },
  { puCode: 'GM-A/W2/001', wardCode: 'GM-A/W2', puName: 'Demo PU A2-001', registeredVoters: 501 },
  { puCode: 'GM-A/W2/002', wardCode: 'GM-A/W2', puName: 'Demo PU A2-002', registeredVoters: 468 },
  { puCode: 'GM-B/W1/001', wardCode: 'GM-B/W1', puName: 'Demo PU B1-001', registeredVoters: 322 },
  { puCode: 'GM-B/W1/002', wardCode: 'GM-B/W1', puName: 'Demo PU B1-002', registeredVoters: 390 },
  { puCode: 'GM-B/W2/001', wardCode: 'GM-B/W2', puName: 'Demo PU B2-001', registeredVoters: 275 },
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
