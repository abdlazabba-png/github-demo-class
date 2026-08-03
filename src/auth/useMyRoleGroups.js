import { useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

const ROLES = ['FieldAgent', 'Coordinator', 'Reviewer', 'PartyAdmin'];

// CLAUDE.md's "Role matrix": role is scoped PER PARTY CLIENT, not global —
// amplify/auth/resource.ts provisions compound groups like
// 'party-demo-alpha__Reviewer' rather than a flat 'Reviewer' group (a
// custom-Lambda-authorizer approach using flat, party-independent role
// groups was tried first and had to be abandoned — see that file's
// comment for the full account of why). Mirrors usePartyClientGroups.js's
// pattern — one fetchAuthSession() call, cognito:groups off the access
// token — not the old useMyRole.js's pattern (a plain custom:role user
// attribute, not a real group membership; that hook predated role groups
// entirely and only ever gated one UI affordance).
//
// This hook only decides what the UI shows for the CURRENTLY VIEWED party
// client — amplify/data/resource.ts's groupDefinedIn('requiredCreatorGroup')
// rule is what actually enforces it; AppSync rejects a create() call
// regardless of what this hook returns.
export function useMyRoleGroups(partyClientId) {
  const [state, setState] = useState({ loading: true, roles: [], error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const groups = session.tokens?.accessToken?.payload['cognito:groups'] || [];
        const mine = ROLES.filter((r) => groups.includes(`${partyClientId}__${r}`));
        if (!cancelled) setState({ loading: false, roles: mine, error: null });
      } catch (err) {
        if (!cancelled) setState({ loading: false, roles: [], error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyClientId]);

  return state;
}
