import { useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

// The roster/assignment flow (CLAUDE.md: FieldAgent is "assigned PU(s)
// only", Coordinator is scoped to "their LGA/ward"). Unlike
// useMyRoleGroups.js (which only needs cognito:groups off the access
// token), this also needs the caller's own `sub` — the same identity
// create-role-checked-record/handler.ts's PU check uses server-side, read
// here from the SAME access token payload so client and server are always
// looking at the same value, never a client-supplied email/display string
// (see amplify/data/resource.ts's AgentAssignment comment for why sub,
// not email).
//
// Takes `server` (amplifyClient.js's exports) as a parameter rather than
// importing it directly, matching every dashboard view's own pattern —
// this hook blends auth-session data (the `sub`) with a domain query
// (getAssignmentsForClient), so unlike useMyRoleGroups.js it can't stay
// auth-only.
//
// UI-scoping only, not a security boundary: EvidenceView.jsx/
// DiscrepancyQueue.jsx use assignedWards to filter what a Coordinator SEES
// client-side (their whole tenant's data is already readable via
// groupDefinedIn('partyClientId') — this just narrows the view to match
// CLAUDE.md's stated scope). The real enforcement for FieldAgent's PU
// restriction happens server-side in create-role-checked-record/
// handler.ts's fileSubmission — assignedPUs here is informational only
// (CaptureForm doesn't currently use it to restrict the PU picker, so an
// unassigned-PU submission attempt still fails at the Lambda, just later
// than it could).
export function useMyAssignments(server, partyClientId) {
  const [state, setState] = useState({ loading: true, assignedPUs: [], assignedWards: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const mySub = session.tokens?.accessToken?.payload.sub;
        const all = await server.getAssignmentsForClient(partyClientId);
        const mine = all.filter((a) => a.userSub === mySub);
        const assignedPUs = mine.filter((a) => a.role === 'FieldAgent').map((a) => a.scopeValue);
        const assignedWards = mine.filter((a) => a.role === 'Coordinator').map((a) => a.scopeValue);
        if (!cancelled) setState({ loading: false, assignedPUs, assignedWards, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, assignedPUs: [], assignedWards: [], error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId]);

  return state;
}
