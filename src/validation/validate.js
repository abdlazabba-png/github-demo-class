// Pure validation logic for the three Phase 2 checks from CLAUDE.md:
// OCR-vs-manual mismatch, vote-count-vs-registered-voters plausibility,
// and duplicate-submission detection. No I/O, no side effects — this is
// deliberately the single source of truth so the exact same rules run as
// an immediate on-device warning at capture time (src/ui/CaptureForm.jsx)
// and as the server-side discrepancy queue that will feed the party
// dashboard, instead of two copies drifting apart.

const SEVERITY_RANK = { ok: 0, info: 0, unknown: 1, warning: 2, error: 3 };

export function checkOcrMismatch(partyVotes, ocrVotes) {
  if (!ocrVotes || Object.keys(ocrVotes).length === 0) {
    return {
      type: 'ocr_mismatch',
      severity: 'info',
      message: 'No OCR reading available to cross-check.',
    };
  }
  const parties = Object.keys(partyVotes).filter(
    (party) => ocrVotes[party] !== undefined && Number(ocrVotes[party]) !== Number(partyVotes[party])
  );
  if (parties.length === 0) {
    return { type: 'ocr_mismatch', severity: 'ok', message: 'Manual entry matches the OCR reading.' };
  }
  return {
    type: 'ocr_mismatch',
    severity: 'warning',
    message: `Manual entry differs from the OCR reading for: ${parties.join(', ')}.`,
    parties,
  };
}

export function checkPlausibility(partyVotes, registeredVoters) {
  const totalVotes = Object.values(partyVotes).reduce((sum, n) => sum + (Number(n) || 0), 0);

  if (registeredVoters == null) {
    return {
      type: 'plausibility',
      severity: 'unknown',
      message: 'Registered-voter count unavailable for this polling unit.',
      totalVotes,
    };
  }
  if (totalVotes > registeredVoters) {
    return {
      type: 'plausibility',
      severity: 'error',
      message: `Total votes (${totalVotes}) exceed registered voters (${registeredVoters}).`,
      totalVotes,
      registeredVoters,
    };
  }
  const turnout = registeredVoters > 0 ? totalVotes / registeredVoters : 0;
  if (turnout > 0.9) {
    return {
      type: 'plausibility',
      severity: 'warning',
      message: `Turnout is unusually high (${Math.round(turnout * 100)}%) — double-check against the sheet.`,
      totalVotes,
      registeredVoters,
      turnout,
    };
  }
  return {
    type: 'plausibility',
    severity: 'ok',
    message: `Turnout ${Math.round(turnout * 100)}%.`,
    totalVotes,
    registeredVoters,
    turnout,
  };
}

// priorPuCodes: puCodes of OTHER already-recorded submissions (any status,
// any id) to compare against. This is a different notion of "duplicate"
// than SyncQueue's idempotent-resend handling: that dedupes retries of the
// *same* submission id after a crash; this catches two *different*
// submissions (same or different agent/device) reporting the same PU,
// which is a data-integrity concern for review, not something to silently
// merge or overwrite (CLAUDE.md: edits go through a logged reviewer flow).
export function checkDuplicate(puCode, priorPuCodes = []) {
  const priorCount = priorPuCodes.filter((code) => code === puCode).length;
  if (priorCount === 0) {
    return { type: 'duplicate', severity: 'ok', message: 'First submission recorded for this polling unit.' };
  }
  return {
    type: 'duplicate',
    severity: 'error',
    message: `${priorCount} prior submission(s) already recorded for this polling unit.`,
    priorCount,
  };
}

export function worstSeverity(checks) {
  return checks.reduce(
    (worst, check) => (SEVERITY_RANK[check.severity] > SEVERITY_RANK[worst] ? check.severity : worst),
    'ok'
  );
}

export function validateSubmission({ partyVotes, ocrVotes, registeredVoters, puCode, priorPuCodes = [] }) {
  const checks = [
    checkOcrMismatch(partyVotes, ocrVotes),
    checkPlausibility(partyVotes, registeredVoters),
    checkDuplicate(puCode, priorPuCodes),
  ];
  return { checks, overallSeverity: worstSeverity(checks) };
}
