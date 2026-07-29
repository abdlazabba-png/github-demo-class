import { useEffect, useState } from 'react';
import { getUrl } from 'aws-amplify/storage';

// Photos now live in S3 (amplify/storage/resource.ts) — the mock-server
// phase's "not on this device" fallback for a locally-only photo no
// longer applies now that any signed-in client can fetch the real object.
function EvidenceRow({ submission }) {
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
    </li>
  );
}

export default function EvidenceView({ server, partyClientId, stateCode, refreshToken }) {
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    server
      .getSubmissionsForClient(partyClientId, stateCode)
      .then((subs) => {
        if (!cancelled) setSubmissions(subs);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId, stateCode, refreshToken]);

  return (
    <section className="dashboard-view evidence-view">
      <h3>Evidence</h3>
      {error && <p className="hint warn">Couldn't load submissions: {error}</p>}
      {submissions.length === 0 && !error && (
        <p className="hint">No submissions yet for this party client.</p>
      )}
      <ul className="evidence-list">
        {submissions.map((s) => (
          <EvidenceRow key={s.id} submission={s} />
        ))}
      </ul>
    </section>
  );
}
