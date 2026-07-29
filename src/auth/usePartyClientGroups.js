import { useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { PARTY_CLIENTS } from '../referenceData/partyClients.js';

// Cognito group membership is the real access-control boundary
// (amplify/data/resource.ts's groupDefinedIn('partyClientId') rule) — this
// hook exists so the UI can never offer a party client the signed-in user
// doesn't actually belong to. Group names are chosen to exactly match
// partyClients.js's ids (see amplify/auth/resource.ts), so matching here
// is a plain string comparison, not a separate mapping table to keep in
// sync.
export function useMyPartyClients() {
  const [state, setState] = useState({ loading: true, partyClients: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const groups = session.tokens?.accessToken?.payload['cognito:groups'] || [];
        const mine = PARTY_CLIENTS.filter((c) => groups.includes(c.id));
        if (!cancelled) setState({ loading: false, partyClients: mine, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, partyClients: [], error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
