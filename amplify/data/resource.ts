import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { createRoleCheckedRecord } from '../functions/create-role-checked-record/resource.js';

// Mirrors the submission payload shape built up across Phases 1-4
// (src/ui/CaptureForm.jsx's payload, src/sync/mockServer.js's stored
// record) — this is the real-backend replacement for that mock, not a
// redesign. partyClientId + stateCode together are the tenant boundary
// (see ../auth/resource.ts); groupDefinedIn('partyClientId') means AppSync
// itself refuses a query/mutation for a party client the caller isn't a
// Cognito-group member of, regardless of what the client asks for.
//
// read only here — no create/update/delete. "Never silently editable
// after submission" (CLAUDE.md) is enforced by the schema, not left to app
// convention. The logged reviewer/edit flow lives entirely in the
// SubmissionCorrection model below: it never mutates a Submission row,
// it only ever adds a new, attributed, reasoned record layered on top.
//
// Creation history (why there's no 'create' rule below and the model's
// own auto-generated createSubmission mutation is permanently
// unreachable): the role matrix (CLAUDE.md) requires the FieldAgent role
// group AND membership in the record's own partyClientId group together.
// Two approaches were tried and abandoned before landing on the real fix:
//   1. A custom Lambda authorizer — confirmed live that AppSync resolves
//      auth mode from the credential's own shape before checking
//      field-level permissions, so a genuine Cognito access token (which
//      every signed-in user already has) is unconditionally treated as
//      userPool auth on this API, never lambda, regardless of client-side
//      authMode hints (see ../auth/resource.ts for the full account).
//   2. A `requiredCreatorGroup` field the client set to
//      `${partyClientId}__FieldAgent`, checked via
//      groupDefinedIn('requiredCreatorGroup').to(['create']). This
//      correctly rejected a caller with NO real membership in that group,
//      but groupDefinedIn only checks that the caller is a REAL member of
//      *whatever group name is in the field* — it can't tell "the group
//      this specific model/operation requires" from "any group I honestly
//      belong to". A caller hitting AppSync directly (bypassing the
//      UI/client entirely — the exact threat model this rule exists for)
//      who was honestly a member of some OTHER compound group for the
//      party (e.g. a real Reviewer) could set requiredCreatorGroup to
//      their own group on a Submission create and be authorized,
//      escalating past the FieldAgent-only boundary. Confirmed
//      empirically, not just theorized, before this was replaced.
// The actual fix: creation now goes entirely through the custom
// `fileSubmission` mutation below, backed by
// ../functions/create-role-checked-record/handler.ts. That Lambda is a
// custom-business-logic resolver, NOT an authorizer, invoked from inside
// an already-userPool-authenticated request — it never hits the
// auth-mode-resolution wall from attempt 1. AppSync populates
// event.identity.groups from the caller's REAL, verified Cognito session
// before the Lambda ever runs, so the group check there trusts nothing
// the client supplies, closing the gap attempt 2 left open. The model's
// own create rule is gone entirely (same as update/delete, which never
// had one) — `allow.authenticated()` on the custom mutation is
// deliberately coarse; the Lambda is what's actually authoritative. read
// stays on groupDefinedIn('partyClientId') since every role in the matrix
// needs tenant-scoped read (FieldAgent's "view own pending" is about the
// local, unsynced IndexedDB queue, not this table).
//
// validationSeverity/validationChecks are left nullable and are NOT
// written by the client. Duplicate detection needs visibility across all
// of a party client's submissions, which no single agent's device has —
// same reasoning as the mock-server phase (src/validation/validate.js).
// Populated by amplify/functions/validate-submission/handler.ts via
// DynamoDB Streams -> Lambda reusing src/validation/validate.js.
// CaptureForm already runs the two checks that ARE safe to compute
// client-side (OCR-mismatch, plausibility) for an immediate agent-facing
// warning; that doesn't change with a real backend.
const schema = a.schema({
  Submission: a
    .model({
      partyClientId: a.string().required(),
      stateCode: a.string().required(),
      agentId: a.string().required(),
      puCode: a.string().required(),
      wardCode: a.string().required(),
      lgaCode: a.string().required(),
      partyVotes: a.json().required(), // { APC: number, PDP: number, ... }
      ocrVotes: a.json(), // same shape, or {} if OCR made no confident guess
      photoKey: a.string(), // S3 object key in ../storage/resource.ts's bucket
      gpsLat: a.float(),
      gpsLng: a.float(),
      gpsAccuracy: a.float(),
      deviceId: a.string(),
      submissionHash: a.string().required(), // tamper-evidence hash; pair with photo, never trust alone
      // epoch ms from the capturing device. AWSTimestamp is seconds, not ms
      // (unit mismatch), and GraphQL's Int is 32-bit signed (~2.1 billion
      // max) — Date.now() in ms is a ~13-digit number that overflows it
      // immediately (confirmed live: every create() failed with "Variable
      // 'clientTimestamp' has an invalid value" until this was float).
      // Float is double-precision and represents ms-since-epoch exactly
      // for the foreseeable future, same as JS's own Number type.
      clientTimestamp: a.float(),
      validationSeverity: a.string(), // 'ok' | 'info' | 'unknown' | 'warning' | 'error' — see note above
      validationChecks: a.json(),
    })
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['read'])])
    .secondaryIndexes((index) => [
      // Dashboard's "coverage / evidence / discrepancy queue" views list
      // one party client's submissions for one state at a time.
      index('partyClientId').sortKeys(['stateCode']).queryField('listByPartyClientAndState'),
      // Duplicate-detection needs "prior submissions for this PU" — the
      // future validation Lambda's query, not a client-facing one.
      index('puCode').queryField('listByPollingUnit'),
    ]),

  // The reviewer/edit flow (CLAUDE.md: "never silently editable after
  // submission — edits go through a logged reviewer flow only"). Never
  // updates a Submission row; each correction is its own new, attributed,
  // reasoned, immutable record referencing the submission it corrects.
  // A wrong correction gets ANOTHER correction filed against it, never
  // edited in place — same read-only, no-create/update/delete model shape
  // as Submission above, for the same reason (creation goes through the
  // custom fileCorrection mutation below instead).
  //
  // Scope is partyVotes only for v1 — not PU/ward/LGA (would break
  // puCode-indexed duplicate detection) and not photo/GPS (not what a
  // "data-entry error" means here).
  //
  // Enforcement note: create requires the Reviewer role group AND
  // membership in the record's own partyClientId group together
  // (CLAUDE.md's "Role matrix"), via the same fileCorrection ->
  // create-role-checked-record mechanism as Submission above (see that
  // model's authorization comment for the full history of what was tried
  // and abandoned before this). A FieldAgent, Coordinator, or PartyAdmin
  // (even one correctly scoped to this party) is rejected inside that
  // Lambda based on their REAL Cognito group membership, not merely kept
  // from seeing the "Request Correction" button in
  // src/ui/dashboard/CorrectionForm.jsx. read stays on
  // groupDefinedIn('partyClientId') — every role needs to see the audit
  // trail, only Reviewer needs to add to it.
  SubmissionCorrection: a
    .model({
      submissionId: a.string().required(),
      partyClientId: a.string().required(), // denormalized: needed for the auth rule itself
      stateCode: a.string().required(), // denormalized: needed for the index
      puCode: a.string().required(), // denormalized: avoids a cross-table read in the validation Lambda
      // Signed-in user's email, set by the client from the auth session —
      // never a typed form field. Unlike Submission.agentId (a free-text
      // input on CaptureForm), this is meant to be genuinely
      // session-attributed, matching CLAUDE.md's "never anonymous" for
      // the flow whose entire purpose is auditability.
      reviewerId: a.string().required(),
      // minLength(1) is AppSync's own Validate Transformer, but it's only
      // generated for the MODEL's own create/update resolvers — the
      // now-unreachable model create() doesn't matter anymore (see
      // authorization note above), and the custom fileCorrection mutation
      // this field's real creation path goes through doesn't run through
      // this transformer at all. Kept here as documentation of the
      // constraint and because it still applies to the (unreachable)
      // model create(); create-role-checked-record/handler.ts re-checks
      // reviewerNote.trim() itself, since it's the only place actually
      // enforcing it now.
      reviewerNote: a.string().required().validate((v) => v.minLength(1, 'A reason is required for every correction.')),
      previousPartyVotes: a.json().required(),
      correctedPartyVotes: a.json().required(),
      validationSeverity: a.string(), // server-populated, same pattern as Submission
      validationChecks: a.json(), // server-populated
    })
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['read'])])
    .secondaryIndexes((index) => [
      // Dashboard fetches all of a party client's corrections for a state
      // in one query, then groups by submissionId client-side — same
      // "don't multiply composite indexes for a filter that can cheaply
      // happen client-side" reasoning already used elsewhere in this app.
      index('partyClientId').sortKeys(['stateCode']).queryField('listCorrectionsByPartyClientAndState'),
    ]),

  // The only path left to create either model above. `allow.authenticated()`
  // is deliberately coarse (any signed-in user can attempt the call) —
  // create-role-checked-record/handler.ts is what actually checks the
  // caller's REAL Cognito group membership against
  // `${partyClientId}__FieldAgent` before writing. Returns just the new
  // id: amplifyClient.js's createSubmission() never reads the response,
  // and a minimal return type avoids any risk of a non-null field
  // mismatch on the way out.
  fileSubmission: a
    .mutation()
    .arguments({
      id: a.string().required(), // client-generated UUID; see src/sync/syncQueue.js
      partyClientId: a.string().required(),
      stateCode: a.string().required(),
      agentId: a.string().required(),
      puCode: a.string().required(),
      wardCode: a.string().required(),
      lgaCode: a.string().required(),
      partyVotes: a.json().required(),
      ocrVotes: a.json(),
      photoKey: a.string(),
      gpsLat: a.float(),
      gpsLng: a.float(),
      gpsAccuracy: a.float(),
      deviceId: a.string(),
      submissionHash: a.string().required(),
      clientTimestamp: a.float(),
    })
    .returns(a.customType({ id: a.string().required() }))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createRoleCheckedRecord)),

  // The reviewer/edit flow's only path to create a Correction — see
  // SubmissionCorrection's authorization comment above. Returns
  // a.ref('SubmissionCorrection') because amplifyClient.js's
  // createCorrection() DOES read the response (toCorrectionShape()), unlike
  // fileSubmission above.
  fileCorrection: a
    .mutation()
    .arguments({
      submissionId: a.string().required(),
      partyClientId: a.string().required(),
      stateCode: a.string().required(),
      puCode: a.string().required(),
      reviewerId: a.string().required(),
      reviewerNote: a.string().required(),
      previousPartyVotes: a.json().required(),
      correctedPartyVotes: a.json().required(),
    })
    .returns(a.ref('SubmissionCorrection'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createRoleCheckedRecord)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
