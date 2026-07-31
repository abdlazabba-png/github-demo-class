import { useEffect, useMemo, useState } from 'react';
import { getStateDataset } from '../../referenceData/states/index.js';
import { CoverageMeter, LgaBarChart, SubmissionsTimeline } from './CoverageCharts.jsx';

// CLAUDE.md, non-negotiable: "Never display a live 'who's winning' number
// or leaderboard. Any aggregate view must be framed as 'unofficial, N of N
// polling units reporting' — never as a result." This view only ever
// counts *whether a PU has reported*, never what was reported. Nothing
// here reads partyVotes, and nothing should ever be added that does. The
// charts in CoverageCharts.jsx inherit this rule — they visualize the same
// reporting counts this view already computes, never vote figures.
export default function CoverageView({ server, partyClientId, stateCode, refreshToken }) {
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

  const reportedPuCodes = useMemo(() => new Set(submissions.map((s) => s.payload.puCode)), [submissions]);

  // The "N of N" denominator is always this one state's own PU count —
  // mixing another state's total in would misrepresent both (Phase 4).
  const { LGAS, WARDS, POLLING_UNITS } = useMemo(() => getStateDataset(stateCode), [stateCode]);

  const totalPUs = POLLING_UNITS.length;
  const reportedCount = reportedPuCodes.size;

  const byLga = LGAS.map((lga) => {
    const wardCodesInLga = new Set(WARDS.filter((w) => w.lgaCode === lga.lgaCode).map((w) => w.wardCode));
    const pusInLga = POLLING_UNITS.filter((p) => wardCodesInLga.has(p.wardCode));
    const reported = pusInLga.filter((p) => reportedPuCodes.has(p.puCode)).length;
    return { ...lga, total: pusInLga.length, reported };
  });

  return (
    <section className="dashboard-view coverage-view">
      <h3>Coverage</h3>
      <p className="coverage-headline">
        Unofficial: {reportedCount} of {totalPUs} polling units reporting
      </p>
      <p className="hint">
        Coverage only — not a result. This never shows vote totals, and there is no leaderboard.
      </p>
      {error && <p className="hint warn">Couldn't load coverage: {error}</p>}

      <CoverageMeter reported={reportedCount} total={totalPUs} />

      <h4>Reporting by LGA</h4>
      <LgaBarChart byLga={byLga} />

      <h4>Submissions received over time</h4>
      <SubmissionsTimeline receivedAtTimestamps={submissions.map((s) => s.receivedAt)} />

      <h4>Reporting by LGA (table)</h4>
      <table>
        <thead>
          <tr>
            <th>LGA</th>
            <th>PUs reporting</th>
          </tr>
        </thead>
        <tbody>
          {byLga.map((l) => (
            <tr key={l.lgaCode}>
              <td>{l.lgaName}</td>
              <td>
                {l.reported} of {l.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
