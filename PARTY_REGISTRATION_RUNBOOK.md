# Party Client Registration — Runbook

This is a manual, repeatable process until an admin tool exists (see
CLAUDE.md / PILOT_READINESS.md for that follow-up). Follow every step in
order, and do not skip the verification step at the end — isolation bugs
here are silent, not loud.

> **Verified 2026-07-31 against the real files.** The code snippets below now
> match what's actually in `amplify/auth/resource.ts`, `amplify/storage/resource.ts`,
> and `src/referenceData/partyClients.js` — this is a ready-to-apply diff shape,
> not a generic template.

---

## Step 0 — Decide the party identifier, once, before touching any file

Pick a single short identifier and use it **identically, character-for-character**,
in all three files. Any mismatch (casing, typo, extra character) is the exact
failure mode that can silently break data isolation between clients.

- Match the existing naming convention: lowercase, hyphenated, `party-`
  prefixed — the two seeded demo clients are `party-demo-alpha` and
  `party-demo-beta`, so e.g. `party-realname` or `party-acme`, not `partyA`.
- Recommend a neutral internal code, not the party's public name directly —
  keeps the codebase itself from being a place where client identity leaks.
- Write this identifier down somewhere you'll copy-paste from — don't retype
  it in each file.

**This session's identifier:** `______________`

The examples below use `party-example` — substitute your real identifier
everywhere it appears.

---

## Step 1 — Add the Cognito group (`amplify/auth/resource.ts`)

This defines the tenant boundary that everything else keys off. The real
file's `defineAuth({...})` already has `loginWith`, `triggers`, and
`userAttributes` set up — the only line to touch is the `groups` array:

```ts
// amplify/auth/resource.ts — only this one line changes
groups: ['party-demo-alpha', 'party-demo-beta', 'party-example'],
```

- [ ] Identifier appended to the existing `groups` array (don't touch
      `loginWith`/`triggers`/`userAttributes` — nothing there changes)
- [ ] Identifier matches Step 0 exactly

---

## Step 2 — Add the S3 storage path rule (`amplify/storage/resource.ts`)

This scopes photo storage so only the new party's group can read/write its
own submissions. The bucket is named `resultSheetPhotos`, and every path
rule is prefixed with `photos/` — this prefix is not optional, it's where
`src/sync/amplifyClient.js`'s `createSubmission()` actually uploads to
(`photos/${partyClientId}/${record.id}.jpg`). A rule missing it grants
access to a path nothing ever writes to, while the real upload path stays
ungoverned — a silent isolation gap, not an error.

```ts
// amplify/storage/resource.ts — add one line inside the existing access map
export const storage = defineStorage({
  name: 'resultSheetPhotos',
  access: (allow) => ({
    'photos/party-demo-alpha/*': [allow.groups(['party-demo-alpha']).to(['read', 'write'])],
    'photos/party-demo-beta/*': [allow.groups(['party-demo-beta']).to(['read', 'write'])],
    'photos/party-example/*': [allow.groups(['party-example']).to(['read', 'write'])],
  }),
});
```

- [ ] Path rule starts with `photos/` — not just the identifier alone
- [ ] `allow.groups([...])` references the exact group name from Step 1
- [ ] No other party's group is listed on this rule

---

## Step 3 — Add the reference-data entry (`src/referenceData/partyClients.js`)

The real file exports a plain array, `PARTY_CLIENTS`, of `{ id, name }`
objects, plus a `findPartyClient(id)` lookup — every consumer
(`src/auth/usePartyClientGroups.js`, `PartyDashboard.jsx`) expects exactly
this shape. `id` is what gets matched against `cognito:groups`, so it must
equal the Step 1 identifier exactly; there's no separate `cognitoGroup` or
`storagePrefix` field to keep in sync — `id` *is* both.

```js
// src/referenceData/partyClients.js — add one entry to the existing array
export const PARTY_CLIENTS = [
  { id: 'party-demo-alpha', name: 'Demo Party Client Alpha' },
  { id: 'party-demo-beta', name: 'Demo Party Client Beta' },
  { id: 'party-example', name: '____________________' }, // decide: official party name vs. discreet internal label
];
```

- [ ] `id` matches Step 1's identifier exactly (this is the only field the
      app actually keys isolation off — get it right)
- [ ] `name` decision made deliberately (see the "real name/identity
      decision" flag from the readiness file — don't default to the party's
      public name without thinking it through)
- [ ] **No per-state/per-LGA scoping exists today** — a registered party
      client currently gets access to every state in the app's reference
      data, not a licensed subset. If a real license is state- or
      LGA-limited, that's an unbuilt feature, not a config field to fill
      in — flag it as a follow-up rather than assuming it's enforced.

---

## Step 4 — Commit and deploy

```bash
git add amplify/auth/resource.ts amplify/storage/resource.ts src/referenceData/partyClients.js
git commit -m "Register party client: party-example"
git push origin master
```

This triggers Amplify Hosting's `amplify.yml` pipeline (`ampx pipeline-deploy`)
— backend CDK deploy + frontend build, roughly 10 minutes per the readiness
notes. **This is the only way the party actually exists on the real,
deployed backend.**

- [ ] Pushed to the branch connected to Amplify Hosting
- [ ] Build shows green in the Amplify Hosting console
- [ ] Confirmed backend phase (not just frontend) completed successfully

---

## Step 5 — Create the party's first admin/dashboard user

Because this goes through `admin-create-user`, **the automatic
`PostConfirmation` group-assignment trigger will not fire** — group
membership must be set explicitly, on the deployed pool, not the sandbox one.

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <DEPLOYED_POOL_ID> \
  --username party-admin@example.com \
  --user-attributes Name=email,Value=party-admin@example.com

aws cognito-idp admin-set-user-password \
  --user-pool-id <DEPLOYED_POOL_ID> \
  --username party-admin@example.com \
  --password '<temporary-password>' \
  --permanent

aws cognito-idp admin-add-user-to-group \
  --user-pool-id <DEPLOYED_POOL_ID> \
  --username party-admin@example.com \
  --group-name party-example
```

- [ ] **Confirmed `<DEPLOYED_POOL_ID>` is the real deployed pool, not the
      sandbox pool from `amplify_outputs.json`** — these are separate, per
      the sandbox-vs-deployed note in the readiness file. Check the Amplify
      Hosting console's backend environment for the correct pool ID.
- [ ] User added to the correct group (Step 1's identifier)
- [ ] Temporary password communicated to the client through a secure channel,
      not email/plaintext chat

---

## Step 6 — Verify isolation before handing off credentials

Do not skip this. This is the step that actually catches a Step 0–3 mismatch.

- [ ] Log in as the new party's user; confirm the dashboard shows **zero**
      submissions/data (nothing exists yet, so this is a blank-state check)
- [ ] Upload a test submission photo as this party; confirm it lands under
      the correct S3 prefix (`photos/party-example/...`, **not** just
      `party-example/...`) in the console
- [ ] Log in as a **different, existing** party's user and confirm they
      **cannot** see the new party's test data anywhere — dashboard, S3
      browser access, or API query
- [ ] Delete the test submission/photo once verified

---

## Step 7 — Record the registration

Keep a simple internal log (separate from the codebase, e.g. a private sheet)
of: party identifier, real-world party name/contact, date registered, state
scope, coverage (full/partial), license dates. This is your operational
source of truth for billing and support — the code only needs to know the
technical identifier, not the business relationship details.

---

## Known gotchas to re-check if something looks wrong

- **Sandbox vs. deployed backend are separate.** A group/user/fix made via
  `npx ampx sandbox` does not exist on the real site. Always verify against
  the deployed pool ID.
- **`admin-create-user` skips the auto-assignment trigger.** Manual
  `admin-add-user-to-group` is required every time this method is used.
- **`amplify_outputs.json` committed to git** reflects the last local
  sandbox build, not the deployed backend — don't use it to look up the
  deployed pool ID.
