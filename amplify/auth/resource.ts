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
//
// CLAUDE.md's "Role matrix" adds a SECOND dimension — FieldAgent/
// Coordinator/Reviewer/PartyAdmin — checked TOGETHER with the tenant group
// above on party-scoped writes (Submission/SubmissionCorrection creation).
//
// This is NOT modeled as orthogonal, party-independent role groups.
// First attempt was exactly that (4 flat groups + a custom Lambda
// authorizer to AND a static role-group check with the per-record
// groupDefinedIn('partyClientId') check) — abandoned after confirming
// live that it cannot work on this API: AppSync resolves which auth mode
// a request used BEFORE checking field-level permissions, based on the
// credential's own shape, not on any client-side hint. A genuine Cognito
// access token — which is what every signed-in user already has, for the
// SAME user pool used everywhere else on this API — is unconditionally
// classified as userPool auth, even when the client asks for `lambda`
// mode and even when the target field's schema directive is
// `@aws_lambda`-only. Confirmed via a raw HTTP POST straight to AppSync
// (bypassing the Amplify client, `authMode`, everything) with a valid
// FieldAgent token: still "Not Authorized", with zero invocations ever
// reaching the authorizer Lambda (confirmed empty in CloudWatch), while a
// direct `aws lambda invoke` with the exact same token correctly returned
// `{"isAuthorized":true}` — proving the authorizer's own logic was sound
// and the failure was AppSync's request-level auth-mode resolution, not
// anything fixable in the Lambda or the schema wiring.
//
// The groups below instead compound the two dimensions directly into the
// group NAME: `${partyClientId}__${role}`, e.g.
// 'party-demo-alpha__FieldAgent'. This lets ../data/resource.ts express
// the AND-check with the same native groupDefinedIn('someField') rule
// already used everywhere else in this app (see the enforcement note on
// each model there) — zero custom Lambda, zero token-type ambiguity,
// same proven mechanism as the tenant-only rule this augments. The
// tradeoff, accepted deliberately: role groups are no longer global —
// each new party client needs its own FieldAgent/Coordinator/Reviewer/
// PartyAdmin groups, growing the "three touchpoints per new party client"
// cost documented above by a further four (party-scoped) groups. Not
// every role currently needs a compound group (only FieldAgent and
// Reviewer gate a create operation today — see ../data/resource.ts) but
// all four are provisioned uniformly per party client for consistency
// rather than special-casing which two happen to need enforcement today.
//
// Role-group membership is NOT auto-assigned at signup (unlike the tenant
// group above) — it's a manual admin-add-user-to-group step, same as
// custom:role already is today.
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
  groups: [
    'party-demo-alpha',
    'party-demo-beta',
    'party-demo-alpha__FieldAgent',
    'party-demo-alpha__Coordinator',
    'party-demo-alpha__Reviewer',
    'party-demo-alpha__PartyAdmin',
    'party-demo-beta__FieldAgent',
    'party-demo-beta__Coordinator',
    'party-demo-beta__Reviewer',
    'party-demo-beta__PartyAdmin',
  ],
});
