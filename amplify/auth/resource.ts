import { defineAuth } from '@aws-amplify/backend';
import { postConfirmation } from './post-confirmation/resource.js';

// CLAUDE.md: "strict data isolation between party clients... enforce this
// at the access-control layer, not just the UI." Cognito User Groups are
// that access-control layer — ../data/resource.ts's authorization rules
// use groupDefinedIn('partyClientId') so AppSync itself, not just client
// code, refuses to return a record whose partyClientId group the caller
// isn't a member of.
//
// Groups are pre-seeded to match the two demo party clients used
// throughout the mock-server phase (src/referenceData/partyClients.js) so
// isolation is testable immediately after `npx ampx sandbox`. Adding a
// real party client means three touchpoints, not one: a group here, a
// matching path rule in ../storage/resource.ts, and an entry in
// src/referenceData/partyClients.js.
//
// Group membership IS auto-assigned at signup: ./post-confirmation/
// reads custom:partyClientId off the newly confirmed user and calls
// AdminAddUserToGroup. An admin still has to set that attribute at
// user-creation time (admin-create-user --user-attributes
// Name=custom:partyClientId,...) — self-service sign-up with party-client
// selection is a separate, deliberately out-of-scope UX/security decision
// — but the follow-up admin-add-user-to-group call this comment used to
// describe as a required manual step is no longer needed.
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  triggers: {
    postConfirmation,
  },
  userAttributes: {
    'custom:partyClientId': {
      dataType: 'String',
      mutable: true,
      maxLen: 64,
    },
    'custom:role': {
      // 'agent' | 'dashboard' — which of the two CLAUDE.md-described
      // clients this account is for. Not itself a security boundary: both
      // roles for one party client sit in the same Cognito group below.
      // The real boundary is partyClientId/group membership. This
      // attribute is UI routing only (which app surface a user lands on).
      dataType: 'String',
      mutable: true,
      maxLen: 32,
    },
  },
  groups: ['party-demo-alpha', 'party-demo-beta'],
});
