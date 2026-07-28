import { useEffect, useState } from 'react';
import { getPhotoObjectUrl } from '../../sync/photoStore.js';

function localPhotoId(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('local-photo://')) return null;
  return photoUrl.slice('local-photo://'.length);
}

// Photos live in the capturing device's own IndexedDB (src/sync/photoStore.js)
// until a real backend uploads them to S3. In this single-tab demo that's
// the same browser, so the photo genuinely loads; on a real deployment the
// dashboard is a separate client entirely, so this honestly reports "not on
// this device" rather than pretending to fetch something that doesn't
// exist yet, and that's exactly the case a real S3 photoUrl will replace.
function EvidenceRow({ submission }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setPhotoUrl(null);
    setChecked(false);

    const id = localPhotoId(submission.payload.photoUrl);
    if (!id) {
      setChecked(true);
    } else {
      getPhotoObjectUrl(id).then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPhotoUrl(url);
        setChecked(true);
      });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [submission.payload.photoUrl]);

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
        <p className="hint warn">
          Photo not on this device — would be fetched from cloud storage once the real backend
          exists.
        </p>
      ) : (
        <p className="hint">Loading photo…</p>
      )}
    </li>
  );
}

export default function EvidenceView({ server, partyClientId, stateCode, refreshToken }) {
  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    setSubmissions(server.getSubmissionsForClient(partyClientId, stateCode));
  }, [server, partyClientId, stateCode, refreshToken]);

  return (
    <section className="dashboard-view evidence-view">
      <h3>Evidence</h3>
      {submissions.length === 0 && <p className="hint">No submissions yet for this party client.</p>}
      <ul className="evidence-list">
        {submissions.map((s) => (
          <EvidenceRow key={s.id} submission={s} />
        ))}
      </ul>
    </section>
  );
}
