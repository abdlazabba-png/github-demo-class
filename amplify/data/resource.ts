import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// Mirrors the submission payload shape built up across Phases 1-4
// (src/ui/CaptureForm.jsx's payload, src/sync/mockServer.js's stored
// record) — this is the real-backend replacement for that mock, not a
// redesign. partyClientId + stateCode together are the tenant boundary
// (see ../auth/resource.ts); groupDefinedIn('partyClientId') means AppSync
// itself refuses a query/mutation for a party client the caller isn't a
// Cognito-group member of, regardless of what the client asks for.
//
// create + read only — no update/delete. "Never silently editable after
// submission" (CLAUDE.md) is enforced by the schema, not left to app
// convention. The logged reviewer/edit flow lives entirely in the
// SubmissionCorrection model below: it never mutates a Submission row,
// it only ever adds a new, attributed, reasoned record layered on top.
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
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['create', 'read'])])
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
  // edited in place — same create+read-only, no-update/delete shape as
  // Submission itself, for the same reason.
  //
  // Scope is partyVotes only for v1 — not PU/ward/LGA (would break
  // puCode-indexed duplicate detection) and not photo/GPS (not what a
  // "data-entry error" means here).
  //
  // Enforcement note: this authorization rule only checks
  // groupDefinedIn('partyClientId'), same as Submission — it does NOT
  // restrict corrections to a privileged "reviewer" sub-role. Any signed-in
  // member of a party client's Cognito group can call this create
  // mutation directly, regardless of their custom:role. The UI (see
  // src/ui/dashboard/CorrectionForm.jsx) only shows the control to
  // custom:role=dashboard accounts, but that is a UI gate, not an
  // access-control boundary — deliberate: the guarantee this model
  // provides is "immutable original + full attribution + full audit
  // trail," not "restricted to a privileged few." A truly enforced
  // boundary would need a second Cognito group per party client, doubling
  // the already-tedious "three touchpoints per new party client" cost
  // documented in ../auth/resource.ts.
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
      reviewerNote: a.string().required(),
      previousPartyVotes: a.json().required(),
      correctedPartyVotes: a.json().required(),
      validationSeverity: a.string(), // server-populated, same pattern as Submission
      validationChecks: a.json(), // server-populated
    })
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['create', 'read'])])
    .secondaryIndexes((index) => [
      // Dashboard fetches all of a party client's corrections for a state
      // in one query, then groups by submissionId client-side — same
      // "don't multiply composite indexes for a filter that can cheaply
      // happen client-side" reasoning already used elsewhere in this app.
      index('partyClientId').sortKeys(['stateCode']).queryField('listCorrectionsByPartyClientAndState'),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
