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
// convention; a logged reviewer/edit flow is its own future model with
// its own audited path, not a bolt-on update permission here.
//
// validationSeverity/validationChecks are left nullable and are NOT
// written by the client. Duplicate detection needs visibility across all
// of a party client's submissions, which no single agent's device has —
// same reasoning as the mock-server phase (src/validation/validate.js).
// Populating these for real needs a server-side step (DynamoDB Streams ->
// Lambda reusing src/validation/validate.js -> update the record) that
// isn't implemented in this pass: it's untested AWS-side wiring with no
// way to verify it here without deploy access, so it's tracked as a
// concrete next step rather than shipped unverified. CaptureForm already
// runs the two checks that ARE safe to compute client-side (OCR-mismatch,
// plausibility) for an immediate agent-facing warning; that doesn't
// change with a real backend.
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
      clientTimestamp: a.integer(), // epoch ms from the capturing device (AWSTimestamp is seconds, not ms — plain integer avoids that unit mismatch)
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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
