import { useEffect, useState } from 'react';
import { fetchAuthSession, fetchUserAttributes } from 'aws-amplify/auth';

// custom:role ('agent' | 'dashboard', amplify/auth/resource.ts) is
// documented there as "UI routing only... not a security boundary" — this
// hook is its first real consumer, gating whether the reviewer/edit flow's
// "Request Correction" control is shown (src/ui/dashboard/CorrectionForm.jsx
// callers). It is NOT what makes that gate secure; see the enforcement note
// on SubmissionCorrection in amplify/data/resource.ts for what actually is.
//
// Tries the ID token's payload first, matching how
// usePartyClientGroups.js already reads cognito:groups off a token via one
// fetchAuthSession() call with no extra network round trip. Falls back to
// fetchUserAttributes() if the token doesn't carry the custom claim —
// unconfirmed which path actually applies until verified live against the
// real deployed pool, same "confirm live" gap this codebase already flags
// elsewhere for Cognito token-shape assumptions.
export function useMyRole() {
  const [state, setState] = useState({ loading: true, role: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        let role = session.tokens?.idToken?.payload?.['custom:role'] || null;
        if (!role) {
          const attributes = await fetchUserAttributes();
          role = attributes['custom:role'] || null;
        }
        if (!cancelled) setState({ loading: false, role });
      } catch (err) {
        if (!cancelled) setState({ loading: false, role: null, error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
