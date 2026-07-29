import { defineStorage } from '@aws-amplify/backend';

// Result-sheet photos, replacing the local-only photoStore.js IndexedDB
// blob store from the mock-server phase with real, durable storage a
// party dashboard on a different device can actually fetch from (Phase 2's
// EvidenceView had an honest "not on this device" fallback specifically
// for this gap — this is what closes it).
//
// Paths are scoped per party-client group, matching the same boundary as
// ../data/resource.ts: a party client's own prefix, nothing else. This is
// a static per-client rule list rather than a dynamic {entity_id}-style
// token because that token resolves to the caller's own Cognito identity,
// not an arbitrary group/tenant name — there's no built-in "scope by the
// group I'm in" path token. Adding a real party client means three
// touchpoints: a group in ../auth/resource.ts, a path rule here, and an
// entry in src/referenceData/partyClients.js.
export const storage = defineStorage({
  name: 'resultSheetPhotos',
  access: (allow) => ({
    'photos/party-demo-alpha/*': [allow.groups(['party-demo-alpha']).to(['read', 'write'])],
    'photos/party-demo-beta/*': [allow.groups(['party-demo-beta']).to(['read', 'write'])],
  }),
});
