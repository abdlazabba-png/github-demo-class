import { useEffect, useState } from 'react';
import { getUrl } from 'aws-amplify/storage';
import CorrectionHistory from './CorrectionHistory.jsx';
import FlagHistory from './FlagHistory.jsx';
import FlagIssueForm from './FlagIssueForm.jsx';

// Photos now live in S3 (amplify/storage/resource.ts) — the mock-server
// phase's "not on this device" fallback for a locally-only photo no
// longer applies now that any signed-in client can fetch the real object.
//
// This is now a SECOND write-action surface (the Coordinator flow's "Flag
// Issue" button), no longer purely read-only as the old comment here said.
// That's deliberate, not a layering slip: a Coordinator's whole value is
// catching what the automated OCR-mismatch/plausibility/duplicate checks
// miss, so the flag action has to live wherever a Coordinator browses
// EVERY submission — DiscrepancyQueue.jsx only ever shows submissions
// already flagged or algorithmically discrepant, which would make it
// impossible to flag anything new from there.
function EvidenceRow({ server, submission, coordinatorId, myRoles, onFlagged }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhotoUrl(null);
    setChecked(false);

    const photoKey = submission.payload.photoKey;
    if (!photoKey) {
      setChecked(true);
    } else {
      getUrl({ path: photoKey })
        .then(({ url }) => {
          if (!cancelled) {
            setPhotoUrl(url.toString());
            setChecked(true);
          }
        })
        .catch(() => {
          if (!cancelled) setChecked(true);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [submission.payload.photoKey]);

  return (
    <li className="evidence-row">
      <div className="evidence-meta">
        <strong>{submission.payload.puCode}</strong>
        <span>agent {submission.payload.agentId}</span>
        <span>{new Date(submission.receivedAt).toLocaleString()}</span>
      </div>
      {photoUrl ? (
        <img src={photoUrl} alt={`Result sheet for ${submission.payload.puCode}`} />
      ) : checked ? (
        <p className="hint warn">No photo on file for this submission.</p>
      ) : (
        <p className="hint">Loading photo…</p>
      )}
      <CorrectionHistory corrections={submission.corrections} />
      <FlagHistory flags={submission.flags} />
      {myRoles.includes('Coordinator') && (
        <FlagIssueForm server={server} submission={submission} coordinatorId={coordinatorId} onFiled={onFlagged} />
      )}
    </li>
  );
}

// assignedWards (from useMyAssignments.js, PartyDashboard.jsx) narrows
// what a Coordinator SEES here to "their LGA/ward" (CLAUDE.md) —
// client-side filtering on data already readable via
// groupDefinedIn('partyClientId'), not an access-control boundary itself.
// Fail-open (show everything) when assignedWards is empty: a Coordinator
// with zero ward assignments is unrestricted, same rollout reasoning as
// FieldAgent's server-side PU check in create-role-checked-record/
// handler.ts (see amplify/data/resource.ts's AgentAssignment comment).
function filterByAssignedWards(submissions, assignedWards) {
  if (!assignedWards || assignedWards.length === 0) return submissions;
  return submissions.filter((s) => assignedWards.includes(s.payload.wardCode));
}

export default function EvidenceView({ server, partyClientId, stateCode, refreshToken, coordinatorId, myRoles, assignedWards }) {
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    server
      .getSubmissionsWithHistoryForClient(partyClientId, stateCode)
      .then((subs) => {
        if (!cancelled) setSubmissions(subs);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId, stateCode, refreshToken, localRefresh]);

  const visibleSubmissions = filterByAssignedWards(submissions, assignedWards);

  return (
    <section className="dashboard-view evidence-view">
      <h3>Evidence</h3>
      {error && <p className="hint warn">Couldn't load submissions: {error}</p>}
      {visibleSubmissions.length === 0 && !error && (
        <p className="hint">No submissions yet for this party client.</p>
      )}
      <ul className="evidence-list">
        {visibleSubmissions.map((s) => (
          <EvidenceRow
            key={s.id}
            server={server}
            submission={s}
            coordinatorId={coordinatorId}
            myRoles={myRoles}
            onFlagged={() => setLocalRefresh((t) => t + 1)}
          />
        ))}
      </ul>
    </section>
  );
}
