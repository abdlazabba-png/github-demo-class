import { useMemo, useRef, useState } from 'react';

// Visual layer for CoverageView.jsx's own data — CLAUDE.md's "never a
// result, never a leaderboard" rule applies here exactly as it does to the
// table these charts sit beside: every number plotted is a *count of
// reports received*, never a vote count. Nothing here reads partyVotes.
//
// Single sequential hue throughout (the app's own --accent), per the
// dataviz method: these are all magnitude/trend charts, not multi-series
// identity comparisons, so there's no categorical palette to validate —
// one hue, more-is-fuller/taller, is the correct and simplest encoding.

// A single ratio against a limit -> a meter, not a one-bar bar chart.
export function CoverageMeter({ reported, total }) {
  const pct = total > 0 ? Math.round((reported / total) * 100) : 0;
  const fillPct = total > 0 ? (reported / total) * 100 : 0;
  return (
    <div className="viz-meter">
      <div className="viz-meter-track" role="img" aria-label={`${reported} of ${total} polling units reporting, ${pct}%`}>
        <div className="viz-meter-fill" style={{ width: `${fillPct}%` }} />
      </div>
      <span className="viz-meter-label">{pct}%</span>
    </div>
  );
}

// Compare magnitude across categories (LGAs), low -> high job, one hue.
// Value is direct-labeled at the bar's tip (mark-spec rule: label the
// endpoint, not every point) so no separate tooltip is needed here.
export function LgaBarChart({ byLga }) {
  const sorted = useMemo(
    () => [...byLga].sort((a, b) => (b.total ? b.reported / b.total : 0) - (a.total ? a.reported / a.total : 0)),
    [byLga]
  );

  if (sorted.length === 0) return null;

  return (
    <ul className="viz-bar-chart" aria-label="Polling units reporting by LGA">
      {sorted.map((l) => {
        const pct = l.total > 0 ? (l.reported / l.total) * 100 : 0;
        return (
          <li key={l.lgaCode} className="viz-bar-row">
            <span className="viz-bar-row-label">{l.lgaName}</span>
            <span className="viz-bar-track" role="img" aria-label={`${l.reported} of ${l.total} reporting`}>
              <span className="viz-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="viz-bar-row-value">
              {l.reported}/{l.total}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Trend over time, one series -> line + soft area fill. Values aren't
// direct-labeled per point (that's chaos on a timeline); a crosshair +
// tooltip carries the per-bucket value on hover/focus instead, and the
// bucket list underneath is the accessibility twin (table view).
export function SubmissionsTimeline({ receivedAtTimestamps }) {
  const svgRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const buckets = useMemo(() => bucketTimestamps(receivedAtTimestamps), [receivedAtTimestamps]);

  if (buckets.length === 0) {
    return <p className="hint">No submissions yet to chart.</p>;
  }

  const width = 640;
  const height = 160;
  const padding = { top: 8, right: 8, bottom: 24, left: 8 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxCount = Math.max(...buckets.map((b) => b.cumulative), 1);
  const xFor = (i) => padding.left + (buckets.length === 1 ? plotWidth / 2 : (i / (buckets.length - 1)) * plotWidth);
  const yFor = (v) => padding.top + plotHeight - (v / maxCount) * plotHeight;

  const linePoints = buckets.map((b, i) => `${xFor(i)},${yFor(b.cumulative)}`).join(' ');
  const areaPoints = `${xFor(0)},${yFor(0)} ${linePoints} ${xFor(buckets.length - 1)},${yFor(0)}`;

  function handleMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const i = buckets.length === 1 ? 0 : Math.round(((relX - padding.left) / plotWidth) * (buckets.length - 1));
    setHoverIndex(Math.max(0, Math.min(buckets.length - 1, i)));
  }

  const hovered = hoverIndex != null ? buckets[hoverIndex] : null;
  // Sparse x-axis ticks: first, last, and roughly one every ~1/4 of the way — never one per point.
  const tickIndices = Array.from(
    new Set([0, Math.floor((buckets.length - 1) / 3), Math.floor(((buckets.length - 1) * 2) / 3), buckets.length - 1])
  );

  return (
    <div className="viz-timeline">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="viz-timeline-svg"
        role="img"
        aria-label="Cumulative submissions received over time"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {/* hairline baseline */}
        <line x1={padding.left} y1={yFor(0)} x2={width - padding.right} y2={yFor(0)} className="viz-axis-line" />
        {/* soft area fill */}
        <polygon points={areaPoints} className="viz-area-fill" />
        {/* line */}
        <polyline points={linePoints} className="viz-line" />
        {/* end marker */}
        <circle
          cx={xFor(buckets.length - 1)}
          cy={yFor(buckets[buckets.length - 1].cumulative)}
          r="4"
          className="viz-end-marker"
        />
        {/* crosshair */}
        {hovered && (
          <>
            <line x1={xFor(hoverIndex)} y1={padding.top} x2={xFor(hoverIndex)} y2={yFor(0)} className="viz-crosshair" />
            <circle cx={xFor(hoverIndex)} cy={yFor(hovered.cumulative)} r="4" className="viz-hover-marker" />
          </>
        )}
        {/* x-axis tick labels */}
        {tickIndices.map((i) => (
          <text key={i} x={xFor(i)} y={height - 6} className="viz-axis-label" textAnchor="middle">
            {buckets[i].label}
          </text>
        ))}
      </svg>
      {hovered && (
        <div
          className="viz-tooltip"
          style={{ left: `${(xFor(hoverIndex) / width) * 100}%` }}
        >
          <strong>{hovered.cumulative}</strong> submissions received by {hovered.label}
        </div>
      )}
    </div>
  );
}

// Buckets a list of epoch-ms timestamps into a cumulative time series.
// Hourly buckets if the data spans under ~36h, daily otherwise — either
// way this stays a small, readable number of points, never one per event.
function bucketTimestamps(timestamps) {
  if (!timestamps || timestamps.length === 0) return [];
  const sorted = [...timestamps].sort((a, b) => a - b);
  const spanMs = sorted[sorted.length - 1] - sorted[0];
  const hourly = spanMs < 36 * 60 * 60 * 1000;
  const bucketMs = hourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  const start = Math.floor(sorted[0] / bucketMs) * bucketMs;
  const end = Math.floor(sorted[sorted.length - 1] / bucketMs) * bucketMs;
  const buckets = [];
  for (let t = start; t <= end; t += bucketMs) {
    buckets.push({ start: t, count: 0 });
  }
  if (buckets.length === 0) buckets.push({ start, count: 0 });

  for (const ts of sorted) {
    const idx = Math.min(buckets.length - 1, Math.floor((ts - start) / bucketMs));
    buckets[idx].count += 1;
  }

  let running = 0;
  return buckets.map((b) => {
    running += b.count;
    const d = new Date(b.start);
    const label = hourly
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return { ...b, cumulative: running, label };
  });
}
