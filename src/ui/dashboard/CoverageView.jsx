import { useEffect, useState } from 'react';
import { LGAS, WARDS, POLLING_UNITS } from '../../referenceData/gombe.js';

// CLAUDE.md, non-negotiable: "Never display a live 'who's winning' number
// or leaderboard. Any aggregate view must be framed as 'unofficial, N of N
// polling units reporting' — never as a result." This view only ever
// counts *whether a PU has reported*, never what was reported. Nothing
// here reads partyVotes, and nothing should ever be added that does.
export default function CoverageView({ server, partyClientId, refreshToken }) {
  const [reportedPuCodes, setReportedPuCodes] = useState(new Set());

  useEffect(() => {
    const submissions = server.getSubmissionsForClient(partyClientId);
    setReportedPuCodes(new Set(submissions.map((s) => s.payload.puCode)));
  }, [server, partyClientId, refreshToken]);

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
