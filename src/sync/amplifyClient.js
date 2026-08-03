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

// Called by SyncQueue's transport() at flush time (see App.jsx) — so it
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

  const result = await client.models.Submission.create({
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
    // CLAUDE.md's "Role matrix": only the FieldAgent role may create
    // Submissions — enforced by amplify/data/resource.ts's
    // groupDefinedIn('requiredCreatorGroup') rule checking real Cognito
    // group membership, not by trusting this string. A caller who isn't
    // actually in this compound group gets rejected by AppSync itself.
    requiredCreatorGroup: `${partyClientId}__FieldAgent`,
  });

  if (result.errors?.length) {
    // A create() whose id already exists fails DynamoDB's conditional
    // PutItem (attribute_not_exists(id)) — that's an idempotent resend
    // after a crash/restart (see src/sync/syncQueue.js), not a real
    // failure, so it's treated as success exactly like mockServer.js did.
    const alreadyExists = result.errors.some((e) => /conditional/i.test(e.message || ''));
    if (!alreadyExists) {
      throw new Error(result.errors.map((e) => e.message).join('; '));
    }
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
  const result = await client.models.SubmissionCorrection.create({
    submissionId,
    partyClientId,
    stateCode,
    puCode,
    reviewerId,
    reviewerNote,
    previousPartyVotes: JSON.stringify(previousPartyVotes),
    correctedPartyVotes: JSON.stringify(correctedPartyVotes),
    // See createSubmission's requiredCreatorGroup comment above — same
    // mechanism, Reviewer role instead of FieldAgent.
    requiredCreatorGroup: `${partyClientId}__Reviewer`,
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

// Shared merge point so no view reimplements the submission<->correction
// join. Attaches, per submission: `corrections` (oldest -> newest) and
// `effectivePartyVotes` (the latest correction's value, or the original
// if none) — corrections chain, so a second correction's "previous" value
// is the first correction's new value, not the original submission's;
// that falls out naturally here since effectivePartyVotes always reflects
// the last item in the (already-sorted) chain.
export async function getSubmissionsWithCorrectionsForClient(partyClientId, stateCode) {
  const [submissions, corrections] = await Promise.all([
    getSubmissionsForClient(partyClientId, stateCode),
    getCorrectionsForClient(partyClientId, stateCode),
  ]);

  const bySubmissionId = new Map();
  for (const correction of corrections) {
    const list = bySubmissionId.get(correction.submissionId) || [];
    list.push(correction);
    bySubmissionId.set(correction.submissionId, list);
  }

  return submissions.map((s) => {
    const ownCorrections = bySubmissionId.get(s.id) || [];
    const latest = ownCorrections[ownCorrections.length - 1];
    return {
      ...s,
      corrections: ownCorrections,
      effectivePartyVotes: latest ? latest.correctedPartyVotes : s.payload.partyVotes,
    };
  });
}

export async function getDiscrepanciesForClient(partyClientId, stateCode) {
  const all = await getSubmissionsWithCorrectionsForClient(partyClientId, stateCode);
  return all.filter((r) => r.validation.overallSeverity === 'warning' || r.validation.overallSeverity === 'error');
}

// Submissions are create+read only (amplify/data/resource.ts) — no update,
// no delete — so the Submissions themselves already are an append-only
// record of what was received, when, by whom. SubmissionCorrection is the
// same shape for the reviewer/edit flow's actions. This merges both into
// one chronological log rather than reading only Submission, now that a
// reviewer/edit flow exists to log actions against.
export async function getAuditLogForClient(partyClientId, stateCode) {
  const [submissions, corrections] = await Promise.all([
    getSubmissionsForClient(partyClientId, stateCode),
    getCorrectionsForClient(partyClientId, stateCode),
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

  return [...submissionEntries, ...correctionEntries].sort((a, b) => a.at - b.at);
}
