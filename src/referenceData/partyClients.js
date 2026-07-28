// PLACEHOLDER / SAMPLE DATA — stands in for real party-client accounts
// until real auth (Amplify/Cognito) exists.
//
// Don't confuse this with the PARTIES list in CaptureForm (APC/PDP/LP/
// NNPP — the parties on the ballot being tallied). A "party client" here
// is the licensee organization running a monitoring operation with this
// tool (CLAUDE.md: "licensed confidentially to any political party
// client") — its own agents, its own submissions. Two party clients are
// seeded so cross-tenant isolation is something we can actually exercise
// now, per CLAUDE.md's "strict data isolation between party clients"
// rule, rather than deferring it untested until real auth lands.
export const PARTY_CLIENTS = [
  { id: 'party-demo-alpha', name: 'Demo Party Client Alpha' },
  { id: 'party-demo-beta', name: 'Demo Party Client Beta' },
];

export function findPartyClient(id) {
  return PARTY_CLIENTS.find((c) => c.id === id);
}
