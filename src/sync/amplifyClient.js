import { generateClient } from 'aws-amplify/data';
import { uploadData } from 'aws-amplify/storage';
import { getPhoto } from './photoStore.js';

// Real-backend replacement for mockServer.js (amplify/data/resource.ts +
// amplify/storage/resource.ts, deployed via `npx ampx sandbox`). Returns
// data reshaped into the exact { id, payload, validation, receivedAt }
// shape mockServer.js always returned, so the four dashboard views
// (src/ui/dashboard/*.jsx) didn't need to change at all — only
// EvidenceView.jsx changed, because photo retrieval genuinely differs
// (S3 object vs. local IndexedDB blob), not because the interface did.
const client = generateClient();

function toDashboardShape(record) {
  return {
    id: record.id,
    receivedAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
    payload: {
      partyClientId: record.partyClientId,
      stateCode: record.stateCode,
      agentId: record.agentId,
      puCode: record.puCode,
      wardCode: record.wardCode,
      lgaCode: record.lgaCode,
      partyVotes: record.partyVotes ? JSON.parse(record.partyVotes) : {},
      ocrVotes: record.ocrVotes ? JSON.parse(record.ocrVotes) : {},
      photoKey: record.photoKey,
      gps:
        record.gpsLat != null
          ? { lat: record.gpsLat, lng: record.gpsLng, accuracy: record.gpsAccuracy }
          : null,
      deviceId: record.deviceId,
    },
    // No server-side validation Lambda exists yet (see the note in
    // amplify/data/resource.ts) — validationSeverity/validationChecks are
    // null until one does. 'unknown' naturally keeps these out of the
    // discrepancy queue rather than needing a separate "not yet validated"
    // UI state.
    validation: {
      overallSeverity: record.validationSeverity || 'unknown',
      checks: record.validationChecks ? JSON.parse(record.validationChecks) : [],
    },
  };
}

function localPhotoId(photoUrl) {
  if (typeof photoUrl !== 'string' || !photoUrl.startsWith('local-photo://')) return null;
  return photoUrl.slice('local-photo://'.length);
}

// Called by SyncQueue's transport() at flush time (see AgentApp.jsx) — so it
// only ever runs when online, same as every other sync-time operation in
// this app. Uploads the locally-queued photo blob to S3 first (if any),
// then creates the Submission record referencing the resulting key.
export async function createSubmission(record) {
  const {
    partyClientId,
    stateCode,
    agentId,
    puCode,
    wardCode,
    lgaCode,
    partyVotes,
    ocrVotes,
    photoUrl,
    gps,
    deviceId,
    timestamp,
  } = record.payload;

  let photoKey = null;
  const photoId = localPhotoId(photoUrl);
  if (photoId) {
    const photo = await getPhoto(photoId);
    if (photo) {
      photoKey = `photos/${partyClientId}/${record.id}.jpg`;
      await uploadData({ path: photoKey, data: photo.blob }).result;
    }
  }

  // The model's own createSubmission mutation is permanently unreachable
  // (see amplify/data/resource.ts's authorization history) — this custom
  // mutation is the only path, and it checks the caller's REAL Cognito
  // group membership server-side in
  // amplify/functions/create-role-checked-record/handler.ts rather than
  // trusting anything this call supplies. A create() whose id already
  // exists is treated as a successful idempotent resend by that Lambda
  // itself now (see its own comment), not by string-matching an error
  // message here the way this used to work.
  const result = await client.mutations.fileSubmission({
    id: record.id, // client-generated UUID, same idempotency key SyncQueue already relies on
    partyClientId,
    stateCode,
    agentId,
    puCode,
    wardCode,
    lgaCode,
    partyVotes: JSON.stringify(partyVotes),
    ocrVotes: JSON.stringify(ocrVotes || {}),
    photoKey,
    gpsLat: gps?.lat ?? null,
    gpsLng: gps?.lng ?? null,
    gpsAccuracy: gps?.accuracy ?? null,
    deviceId,
    submissionHash: record.submissionHash,
    clientTimestamp: timestamp,
  });

  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
}

export async function getSubmissionsForClient(partyClientId, stateCode) {
  // partyClientId is the index's partition key (plain value); stateCode is
  // the sort key, which Amplify's generated query expects as a condition
  // object ({ eq: ... }) rather than a raw value — confirmed live: passing
  // a plain string here fails with "Variable 'stateCode' has an invalid
  // value".
  const { data, errors } = await client.models.Submission.listByPartyClientAndState({
    partyClientId,
    stateCode: { eq: stateCode },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data.map(toDashboardShape).sort((a, b) => a.receivedAt - b.receivedAt);
}

function toCorrectionShape(record) {
  return {
    id: record.id,
    submissionId: record.submissionId,
    reviewerId: record.reviewerId,
    reviewerNote: record.reviewerNote,
    previousPartyVotes: record.previousPartyVotes ? JSON.parse(record.previousPartyVotes) : {},
    correctedPartyVotes: record.correctedPartyVotes ? JSON.parse(record.correctedPartyVotes) : {},
    createdAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
    validation: {
      overallSeverity: record.validationSeverity || 'unknown',
      checks: record.validationChecks ? JSON.parse(record.validationChecks) : [],
    },
  };
}

// The reviewer/edit flow (CLAUDE.md: "edits go through a logged reviewer
// flow only"). Never updates a Submission row — see the enforcement note
// in amplify/data/resource.ts for what this authorization rule does and
// doesn't restrict. reviewerId must come from the caller's own auth
// session (src/ui/dashboard/PartyDashboard.jsx passes it down from
// user.signInDetails.loginId), never a typed field, so this stays
// genuinely session-attributed rather than a copy of Submission.agentId's
// free-text pattern.
export async function createCorrection({
  submissionId,
  partyClientId,
  stateCode,
  puCode,
  previousPartyVotes,
  correctedPartyVotes,
  reviewerId,
  reviewerNote,
}) {
  // The model's own createSubmissionCorrection mutation is permanently
  // unreachable, same as Submission's (see amplify/data/resource.ts's
  // authorization history) — this custom mutation is the only path, and
  // it checks the caller's REAL Cognito Reviewer-group membership
  // server-side in
  // amplify/functions/create-role-checked-record/handler.ts, including
  // the non-empty reviewerNote check that model field's own Validate
  // Transformer can't reach for this path.
  const result = await client.mutations.fileCorrection({
    submissionId,
    partyClientId,
    stateCode,
    puCode,
    reviewerId,
    reviewerNote,
    previousPartyVotes: JSON.stringify(previousPartyVotes),
    correctedPartyVotes: JSON.stringify(correctedPartyVotes),
  });
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  return toCorrectionShape(result.data);
}

export async function getCorrectionsForClient(partyClientId, stateCode) {
  const { data, errors } = await client.models.SubmissionCorrection.listCorrectionsByPartyClientAndState({
    partyClientId,
    stateCode: { eq: stateCode },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data.map(toCorrectionShape).sort((a, b) => a.createdAt - b.createdAt);
}

function toFlagShape(record) {
  return {
    id: record.id,
    submissionId: record.submissionId,
    coordinatorId: record.coordinatorId,
    note: record.note,
    createdAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
  };
}

// The Coordinator flow (CLAUDE.md's role matrix: Coordinator can "flag
// issues; cannot edit vote figures directly"). A flag never touches
// partyVotes — see amplify/data/resource.ts's SubmissionFlag comment for
// why it's a separate model from SubmissionCorrection rather than a
// variant of it. coordinatorId must come from the caller's own auth
// session (src/ui/dashboard/PartyDashboard.jsx passes it down the same way
// reviewerId already is), never a typed field, for the same
// session-attribution reason as createCorrection.
export async function createFlag({ submissionId, partyClientId, stateCode, puCode, coordinatorId, note }) {
  // The model's own createSubmissionFlag mutation is permanently
  // unreachable, same as Submission's/SubmissionCorrection's (see
  // amplify/data/resource.ts's authorization history) — this custom
  // mutation is the only path, and it checks the caller's REAL Cognito
  // Coordinator-group membership server-side in
  // amplify/functions/create-role-checked-record/handler.ts.
  const result = await client.mutations.fileFlag({
    submissionId,
    partyClientId,
    stateCode,
    puCode,
    coordinatorId,
    note,
  });
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  return toFlagShape(result.data);
}

export async function getFlagsForClient(partyClientId, stateCode) {
  const { data, errors } = await client.models.SubmissionFlag.listFlagsByPartyClientAndState({
    partyClientId,
    stateCode: { eq: stateCode },
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data.map(toFlagShape).sort((a, b) => a.createdAt - b.createdAt);
}

function toAssignmentShape(record) {
  return {
    id: record.id,
    userSub: record.userSub,
    userEmail: record.userEmail,
    role: record.role,
    scopeValue: record.scopeValue,
    createdAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
  };
}

// The roster flow (CLAUDE.md: PartyAdmin can "manage agent roster & PU
// assignments"). Takes userEmail, not a sub — see
// amplify/data/resource.ts's AgentAssignment comment for why the actual
// sub resolution and the real-group-membership re-check both happen
// server-side in create-role-checked-record/handler.ts, never trusted
// from this call.
export async function createAssignment({ partyClientId, userEmail, role, scopeValue }) {
  const result = await client.mutations.createAssignment({ partyClientId, userEmail, role, scopeValue });
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  return toAssignmentShape(result.data);
}

// No stateCode filter — an assignment's PU/ward code already implies its
// state, and RosterView.jsx (the only caller) wants every assignment for
// the whole party client at once, not scoped to whichever state happens
// to be selected in the dashboard's state picker.
export async function getAssignmentsForClient(partyClientId) {
  const { data, errors } = await client.models.AgentAssignment.listAssignmentsByPartyClientAndUser({
    partyClientId,
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data.map(toAssignmentShape).sort((a, b) => a.createdAt - b.createdAt);
}

// Shared merge point so no view reimplements the submission<->correction/
// flag joins. Attaches, per submission: `corrections` (oldest -> newest),
// `flags` (oldest -> newest), and `effectivePartyVotes` (the latest
// correction's value, or the original if none) — corrections chain, so a
// second correction's "previous" value is the first correction's new
// value, not the original submission's; that falls out naturally here
// since effectivePartyVotes always reflects the last item in the
// (already-sorted) chain. Flags never affect effectivePartyVotes — they're
// a signal for a Reviewer to look, not a value change themselves.
export async function getSubmissionsWithHistoryForClient(partyClientId, stateCode) {
  const [submissions, corrections, flags] = await Promise.all([
    getSubmissionsForClient(partyClientId, stateCode),
    getCorrectionsForClient(partyClientId, stateCode),
    getFlagsForClient(partyClientId, stateCode),
  ]);

  const correctionsBySubmissionId = new Map();
  for (const correction of corrections) {
    const list = correctionsBySubmissionId.get(correction.submissionId) || [];
    list.push(correction);
    correctionsBySubmissionId.set(correction.submissionId, list);
  }

  const flagsBySubmissionId = new Map();
  for (const flag of flags) {
    const list = flagsBySubmissionId.get(flag.submissionId) || [];
    list.push(flag);
    flagsBySubmissionId.set(flag.submissionId, list);
  }

  return submissions.map((s) => {
    const ownCorrections = correctionsBySubmissionId.get(s.id) || [];
    const latest = ownCorrections[ownCorrections.length - 1];
    return {
      ...s,
      corrections: ownCorrections,
      flags: flagsBySubmissionId.get(s.id) || [],
      effectivePartyVotes: latest ? latest.correctedPartyVotes : s.payload.partyVotes,
    };
  });
}

// A submission surfaces here if the automated checks flagged it (severity
// warning/error) OR a Coordinator manually flagged it — the latter is the
// whole point of the Coordinator role: catching what OCR-mismatch/
// plausibility/duplicate checks miss (CLAUDE.md's Reviewer permission,
// "Create Corrections on flagged or manually-identified submissions",
// covers both sources the same way).
export async function getDiscrepanciesForClient(partyClientId, stateCode) {
  const all = await getSubmissionsWithHistoryForClient(partyClientId, stateCode);
  return all.filter(
    (r) => r.validation.overallSeverity === 'warning' || r.validation.overallSeverity === 'error' || r.flags.length > 0
  );
}

// Submissions are create+read only (amplify/data/resource.ts) — no update,
// no delete — so the Submissions themselves already are an append-only
// record of what was received, when, by whom. SubmissionCorrection and
// SubmissionFlag are the same shape for the reviewer/edit and Coordinator
// flows' actions. This merges all three into one chronological log rather
// than reading only Submission.
export async function getAuditLogForClient(partyClientId, stateCode) {
  const [submissions, corrections, flags] = await Promise.all([
    getSubmissionsForClient(partyClientId, stateCode),
    getCorrectionsForClient(partyClientId, stateCode),
    getFlagsForClient(partyClientId, stateCode),
  ]);

  const submissionEntries = submissions.map((r) => ({
    type: 'submission',
    id: r.id,
    partyClientId: r.payload.partyClientId,
    stateCode: r.payload.stateCode,
    puCode: r.payload.puCode,
    agentId: r.payload.agentId,
    at: r.receivedAt,
    validationSeverity: r.validation.overallSeverity,
  }));

  const correctionEntries = corrections.map((c) => ({
    type: 'correction',
    id: c.id,
    submissionId: c.submissionId,
    reviewerId: c.reviewerId,
    reviewerNote: c.reviewerNote,
    previousPartyVotes: c.previousPartyVotes,
    correctedPartyVotes: c.correctedPartyVotes,
    at: c.createdAt,
    validationSeverity: c.validation.overallSeverity,
  }));

  const flagEntries = flags.map((f) => ({
    type: 'flag',
    id: f.id,
    submissionId: f.submissionId,
    coordinatorId: f.coordinatorId,
    note: f.note,
    at: f.createdAt,
  }));

  return [...submissionEntries, ...correctionEntries, ...flagEntries].sort((a, b) => a.at - b.at);
}
