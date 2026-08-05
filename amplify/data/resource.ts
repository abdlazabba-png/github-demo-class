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

  // The Coordinator flow (CLAUDE.md's role matrix: Coordinator can "view
  // coverage & submissions for their agents; flag issues; cannot edit vote
  // figures directly"). A flag is a lightweight, attributed, permanent
  // annotation on a submission — never a vote-value change, so it's a
  // separate model from SubmissionCorrection, not a variant of it. Unlike
  // a Correction, a flag doesn't require the submission to already be
  // algorithmically discrepant: the whole point of a human Coordinator
  // flagging something is to catch what OCR-mismatch/plausibility/
  // duplicate checks miss (see amplifyClient.js's getDiscrepanciesForClient,
  // which surfaces a submission if it has either a warning/error severity
  // OR at least one flag). Matches CLAUDE.md's Reviewer permission
  // ("Create Corrections on flagged or manually-identified submissions") —
  // a flag is meant to feed a Reviewer's queue, not resolve anything
  // itself.
  //
  // No update/delete, same append-only reasoning as Submission/
  // SubmissionCorrection above: a flag that turns out to be unfounded
  // isn't edited or removed, it just sits in the history — same as an
  // "ok" validation check sitting next to a real one. Multiple flags per
  // submission (from the same or different Coordinators) are allowed and
  // all kept, not deduplicated or replaced.
  //
  // Creation goes through the fileFlag custom mutation below, same
  // create-role-checked-record mechanism as Submission/SubmissionCorrection
  // — checking real `${partyClientId}__Coordinator` membership, not a
  // client-supplied field. read stays on groupDefinedIn('partyClientId'):
  // every role needs to see flags as part of the audit trail, only
  // Coordinator needs to add them.
  SubmissionFlag: a
    .model({
      submissionId: a.string().required(),
      partyClientId: a.string().required(), // denormalized: needed for the auth rule itself
      stateCode: a.string().required(), // denormalized: needed for the index
      puCode: a.string().required(), // denormalized: shown in the queue without a join
      // Signed-in user's email, set by the client from the auth session —
      // never a typed form field, same session-attribution pattern as
      // SubmissionCorrection.reviewerId.
      coordinatorId: a.string().required(),
      note: a.string().required().validate((v) => v.minLength(1, 'A reason is required for every flag.')),
    })
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['read'])])
    .secondaryIndexes((index) => [
      // Same shape as SubmissionCorrection's index — dashboard fetches all
      // of a party client's flags for a state in one query, then groups by
      // submissionId client-side.
      index('partyClientId').sortKeys(['stateCode']).queryField('listFlagsByPartyClientAndState'),
    ]),

  // The roster/assignment flow (CLAUDE.md's role matrix: FieldAgent is
  // scoped to "assigned PU(s) only", Coordinator to "their LGA/ward";
  // PartyAdmin can "manage agent roster & PU assignments"). Until now
  // neither restriction was enforced — every FieldAgent could submit for
  // any PU in the tenant, every Coordinator saw the whole tenant. This
  // model is what an assignment actually IS: one row per (agent, scope)
  // pair — a FieldAgent with 3 assigned PUs gets 3 rows, not an array
  // field, so adding/removing one assignment is a single create, not a
  // read-modify-write of a list.
  //
  // Keyed by userSub (the Cognito `sub` from the caller's verified access
  // token, i.e. event.identity.sub in create-role-checked-record/handler.ts)
  // — NOT email. This access-token identity has no email claim at all
  // (confirmed live: a raw event dump during the Coordinator-flow work
  // showed claims.token_use: "access" with sub/username/cognito:groups but
  // no email), so email can never be trusted as "who the caller really
  // is" the way sub can. userEmail below is denormalized display-only,
  // resolved server-side by createAssignment (never trust a client's own
  // claim about someone else's email either) so the roster view doesn't
  // need N Cognito lookups to render a human-readable list.
  //
  // scopeValue is a puCode when role='FieldAgent', a wardCode when
  // role='Coordinator' — no separate scopeLevel field, since the role
  // alone determines which kind of code it is (matches "Their LGA/ward"
  // at ward granularity; a Coordinator covering a whole LGA gets one row
  // per ward in it, same "multiple rows over one array field" reasoning
  // as PU assignment above).
  //
  // Deliberate rollout choice, not an oversight: enforcement (in
  // fileSubmission below, and client-side in
  // src/ui/dashboard/EvidenceView.jsx/DiscrepancyQueue.jsx for
  // Coordinator's ward filter) is fail-OPEN when a user has zero
  // assignment rows — unrestricted, exactly like before this model
  // existed — and only becomes fail-closed once at least one assignment
  // exists for them. Every existing FieldAgent/Coordinator account has
  // zero rows today; making this fail-closed immediately would have
  // silently locked every one of them out with no roster UI having ever
  // existed to unlock them again.
  AgentAssignment: a
    .model({
      partyClientId: a.string().required(), // denormalized: needed for the auth rule itself
      userSub: a.string().required(),
      userEmail: a.string().required(), // display-only, resolved server-side — never used for enforcement
      role: a.string().required(), // 'FieldAgent' | 'Coordinator'
      scopeValue: a.string().required(), // puCode (FieldAgent) or wardCode (Coordinator)
    })
    .authorization((allow) => [allow.groupDefinedIn('partyClientId').to(['read'])])
    .secondaryIndexes((index) => [
      // Doubles as both queries this app needs: the roster view's "every
      // assignment for this party" (partition key alone, no sort
      // condition) and create-role-checked-record's own "this specific
      // caller's assignments" (partition key + userSub sort condition).
      index('partyClientId').sortKeys(['userSub']).queryField('listAssignmentsByPartyClientAndUser'),
    ]),

  // The only path left to create any of the four models above. `allow.authenticated()`
  // is deliberately coarse (any signed-in user can attempt the call) —
  // create-role-checked-record/handler.ts is what actually checks the
  // caller's REAL Cognito group membership against
  // `${partyClientId}__FieldAgent` before writing — and now, if the caller
  // has any AgentAssignment rows at all, that puCode must be one of them
  // (fail-open with zero rows; see AgentAssignment's comment above for why).
  // Returns just the new id: amplifyClient.js's createSubmission() never
  // reads the response, and a minimal return type avoids any risk of a
  // non-null field mismatch on the way out.
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

  // The Coordinator flow's only path to create a flag — see
  // SubmissionFlag's authorization comment above. Returns
  // a.ref('SubmissionFlag') because amplifyClient.js's createFlag() reads
  // the response the same way createCorrection() does.
  fileFlag: a
    .mutation()
    .arguments({
      submissionId: a.string().required(),
      partyClientId: a.string().required(),
      stateCode: a.string().required(),
      puCode: a.string().required(),
      coordinatorId: a.string().required(),
      note: a.string().required(),
    })
    .returns(a.ref('SubmissionFlag'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createRoleCheckedRecord)),

  // The roster flow's only path to create an assignment — see
  // AgentAssignment's authorization comment above. Takes userEmail (what a
  // PartyAdmin actually knows/types), not userSub: create-role-checked-record
  // resolves the target's real sub via Cognito ListUsers server-side, and
  // verifies that user is genuinely a member of this partyClientId's
  // tenant group before writing anything — a PartyAdmin can't create a
  // bogus assignment for an email outside their own party.
  createAssignment: a
    .mutation()
    .arguments({
      partyClientId: a.string().required(),
      userEmail: a.string().required(),
      role: a.string().required(), // 'FieldAgent' | 'Coordinator'
      scopeValue: a.string().required(),
    })
    .returns(a.ref('AgentAssignment'))
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
