import { useEffect, useMemo, useState } from 'react';
import { lgasListForState, wardsForLgaInState, pollingUnitsForWardInState } from '../../referenceData/states/index.js';

// The roster flow's write-action surface (CLAUDE.md: PartyAdmin can
// "manage agent roster & PU assignments") — PartyAdmin-only, gated at the
// call site (PartyDashboard.jsx) the same way Reviewer/Coordinator gate
// CorrectionForm.jsx/FlagIssueForm.jsx, but real enforcement is
// create-role-checked-record/handler.ts's createAssignment, which
// independently resolves the target email to a real Cognito user and
// re-verifies their actual group membership before writing anything (see
// amplify/data/resource.ts's AgentAssignment comment) — this form can't
// be tricked into assigning someone outside the party or into a role
// they're not really in, regardless of what it submits.
//
// Reuses the SAME per-state LGA/ward/PU reference data CaptureForm.jsx
// cascades through, scoped to whichever state is already selected in
// PartyDashboard.jsx's header — an assignment's scope code only makes
// sense within one state at a time, same as a submission's does.
export default function RosterView({ server, partyClientId, stateCode, refreshToken }) {
  const [assignments, setAssignments] = useState([]);
  const [error, setError] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const [userEmail, setUserEmail] = useState('');
  const [role, setRole] = useState('FieldAgent');
  const [lgaCode, setLgaCode] = useState('');
  const [wardCode, setWardCode] = useState('');
  const [puCode, setPuCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    server
      .getAssignmentsForClient(partyClientId)
      .then((result) => {
        if (!cancelled) setAssignments(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId, refreshToken, localRefresh]);

  const lgas = useMemo(() => lgasListForState(stateCode), [stateCode]);
  const wards = useMemo(() => (lgaCode ? wardsForLgaInState(stateCode, lgaCode) : []), [stateCode, lgaCode]);
  const pus = useMemo(() => (wardCode ? pollingUnitsForWardInState(stateCode, wardCode) : []), [stateCode, wardCode]);

  function handleLgaChange(e) {
    setLgaCode(e.target.value);
    setWardCode('');
    setPuCode('');
  }
  function handleWardChange(e) {
    setWardCode(e.target.value);
    setPuCode('');
  }
  function handleRoleChange(e) {
    setRole(e.target.value);
    setLgaCode('');
    setWardCode('');
    setPuCode('');
  }

  const scopeValue = role === 'FieldAgent' ? puCode : wardCode;
  const canSubmit = Boolean(userEmail.trim()) && Boolean(scopeValue) && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await server.createAssignment({ partyClientId, userEmail: userEmail.trim(), role, scopeValue });
      setUserEmail('');
      setLgaCode('');
      setWardCode('');
      setPuCode('');
      setLocalRefresh((t) => t + 1);
    } catch (err) {
      setFormError(String(err?.message || err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="dashboard-view roster-view">
      <h3>Roster</h3>
      <p className="hint">
        Assigning a FieldAgent narrows which polling unit(s) they can submit for; assigning a
        Coordinator narrows which ward(s) show in their dashboard views. An agent with no
        assignments yet is unrestricted — assigning their first PU or ward is what turns the
        restriction on.
      </p>

      <form className="roster-form" onSubmit={handleSubmit}>
        <label>
          Agent email
          <input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="agent@example.com"
            required
          />
        </label>
        <label>
          Role
          <select value={role} onChange={handleRoleChange}>
            <option value="FieldAgent">FieldAgent (assign a polling unit)</option>
            <option value="Coordinator">Coordinator (assign a ward)</option>
          </select>
        </label>
        <label>
          LGA
          <select value={lgaCode} onChange={handleLgaChange} required>
            <option value="">Select LGA…</option>
            {lgas.map((l) => (
              <option key={l.lgaCode} value={l.lgaCode}>
                {l.lgaName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ward
          <select value={wardCode} onChange={handleWardChange} disabled={!lgaCode} required>
            <option value="">Select ward…</option>
            {wards.map((w) => (
              <option key={w.wardCode} value={w.wardCode}>
                {w.wardName}
              </option>
            ))}
          </select>
        </label>
        {role === 'FieldAgent' && (
          <label>
            Polling unit
            <select value={puCode} onChange={(e) => setPuCode(e.target.value)} disabled={!wardCode} required>
              <option value="">Select PU…</option>
              {pus.map((p) => (
                <option key={p.puCode} value={p.puCode}>
                  {p.puName} ({p.puCode})
                </option>
              ))}
            </select>
          </label>
        )}

        {formError && <p className="hint warn">Couldn't create assignment: {formError}</p>}

        <button type="submit" disabled={!canSubmit}>
          {submitting ? 'Assigning…' : 'Add assignment'}
        </button>
      </form>

      {error && <p className="hint warn">Couldn't load roster: {error}</p>}
      {assignments.length === 0 && !error && <p className="hint">No assignments yet for this party client.</p>}
      {assignments.length > 0 && (
        <table className="roster-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Role</th>
              <th>Scope</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.userEmail}</td>
                <td>{a.role}</td>
                <td>{a.scopeValue}</td>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
