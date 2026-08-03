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
// create requires the FieldAgent role group AND membership in the
// record's own partyClientId group together (CLAUDE.md's "Role matrix").
// A custom Lambda authorizer was the first approach here and had to be
// abandoned — confirmed live that AppSync resolves auth mode from the
// credential's own shape before checking field-level permissions, so a
// genuine Cognito access token (which every signed-in user already has)
// is unconditionally treated as userPool auth on this API, never lambda,
// regardless of client-side authMode hints (see ../auth/resource.ts for
// the full account of what was tried and ruled out). requiredCreatorGroup
// below is the actual fix: the client sets it to
// `${partyClientId}__FieldAgent` at creation time, and groupDefinedIn
// checks the caller is a REAL member of that compound group — a
// FieldAgent-only user can't forge their way past this by lying about the
// field's value, since the check is real Cognito group membership, not
// trust in what the client claims. read stays on
// groupDefinedIn('partyClientId') since every role in the matrix needs
// tenant-scoped read (FieldAgent's "view own pending" is about the local,
// unsynced IndexedDB queue, not this table).
//
// Known residual gap (documented, not fixed here): groupDefinedIn only
// checks that the caller is a REAL member of whatever group name is IN
// the field — it has no idea the field is "supposed to" hold a
// FieldAgent-suffixed value on this model and a Reviewer-suffixed value
// on SubmissionCorrection below. Amplify Gen 2's declarative authorization
// has no AND/cross-field/per-model value constraint to close this
// (confirmed against @aws-amplify/data-schema's own types during the
// Lambda-authorizer attempt referenced above). Going through the real app
// (src/sync/amplifyClient.js) this can't be triggered: createSubmission()
// always hardcodes `${partyClientId}__FieldAgent` and createCorrection()
// always hardcodes `${partyClientId}__Reviewer`, regardless of caller. But
// a caller hitting AppSync directly (bypassing the UI/client entirely, the
// same threat model this whole rule exists to defend against) who is
// honestly a member of SOME compound group for the party — e.g. a real
// FieldAgent — could set requiredCreatorGroup to their OWN group on a
// SubmissionCorrection create and be authorized, escalating past the
// FieldAgent/Reviewer boundary the role matrix intends. Closing this for
// real requires moving the write behind a custom-business-logic mutation
// (a Lambda-backed resolver, NOT an authorizer — no auth-mode conflict,
// since it runs inside the existing userPool-authenticated request) that
// computes/checks this field server-side instead of trusting client input
// for it. Not built here: bigger scope than asked for this pass, and would
// also mean reimplementing create()'s attribute_not_exists(id) idempotency
// by hand. Flag to the user before relying on this as airtight.
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
      // Client sets this to `${partyClientId}__FieldAgent` — see the
      // authorization comment above for why this field exists and why a
      // client can't forge its way past the check by lying about it.
      requiredCreatorGroup: a.string().required(),
    })
    .authorization((allow) => [
      allow.groupDefinedIn('partyClientId').to(['read']),
      allow.groupDefinedIn('requiredCreatorGroup').to(['create']),
    ])
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
  // Enforcement note: create requires the Reviewer role group AND
  // membership in the record's own partyClientId group together
  // (CLAUDE.md's "Role matrix"), via the same requiredCreatorGroup +
  // groupDefinedIn mechanism as Submission above (see that model's
  // authorization comment for why a custom Lambda authorizer was tried
  // first and had to be abandoned). A FieldAgent, Coordinator, or
  // PartyAdmin (even one correctly scoped to this party) is rejected by
  // AppSync itself, not merely kept from seeing the "Request Correction"
  // button in src/ui/dashboard/CorrectionForm.jsx. read stays on
  // groupDefinedIn('partyClientId') — every role needs to see the audit
  // trail, only Reviewer needs to add to it. Same residual gap as
  // Submission's requiredCreatorGroup (see that comment): this only
  // blocks a FieldAgent/Coordinator/PartyAdmin who is honest about which
  // group they're claiming. A caller bypassing the UI who dishonestly
  // sets this field to a real group they belong to (their own, not
  // Reviewer) is not caught by groupDefinedIn alone — not exploitable
  // through this app's own client code, which hardcodes the correct
  // value, but not airtight against a direct API call either.
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
      // Client sets this to `${partyClientId}__Reviewer` — see
      // Submission.requiredCreatorGroup above for the full reasoning.
      requiredCreatorGroup: a.string().required(),
    })
    .authorization((allow) => [
      allow.groupDefinedIn('partyClientId').to(['read']),
      allow.groupDefinedIn('requiredCreatorGroup').to(['create']),
    ])
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
