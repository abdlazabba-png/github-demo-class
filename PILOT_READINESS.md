# Pilot Readiness Checklist

What a real Gombe State pilot needs beyond what's built. Organized by who owns
each item — most of this is **not** an engineering task, and this file exists
so that's explicit rather than left implicit. Written 2026-07-30, after the
core platform (auth, data, storage, server-side validation, group
auto-assignment, CI/CD, budget monitoring) was built and verified end-to-end
against the real AWS backend. **Refreshed 2026-08-04** after the role-group
access-control model (FieldAgent/Coordinator/Reviewer/PartyAdmin), two real
access-control gaps found and closed, and the VerifiVote branding/PWA
installability wiring — see "Already done and verified" below for what
changed and why the "UI-only enforcement" caveat that used to be here is
gone.

## The sandbox and the deployed (Amplify Hosting) backend are separate

`npx ampx sandbox` (used for all manual browser testing this session) and
`npx ampx pipeline-deploy --branch master` (run by Amplify Hosting CI/CD, see
`amplify.yml`) each provision their **own independent backend** — separate
Cognito User Pool, separate DynamoDB tables, separate S3 bucket — even though
both come from the same `amplify/` source. Discovered when a Cognito password
reset applied to the sandbox pool (`eu-north-1_QnEoOjgIs`, the one referenced
by the `amplify_outputs.json` committed to this repo) had no effect on the
deployed site, which turned out to be backed by a second, completely empty
pool (`eu-north-1_BXBv9wsm7`) created by the branch's first `pipeline-deploy`
run.

Practical consequences:
- **No test users, seed data, or manual fixes made against the sandbox carry
  over to the deployed site**, or vice versa. Each needs its own setup.
- `amplify_outputs.json` committed to git reflects whichever backend was last
  built locally (sandbox) — the deployed frontend gets its own copy generated
  fresh during the `backend` phase of `amplify.yml`, not the committed one.
- A user created via `admin-create-user` + `admin-set-user-password` (as
  opposed to a real sign-up/confirm flow) does **not** fire the
  `PostConfirmation` group-auto-assignment trigger — group membership must be
  set explicitly with `admin-add-user-to-group` for accounts provisioned this
  way, in either backend. Since the role-group work (below), this now means
  **two** groups per test account — the tenant group (`party-demo-alpha`)
  and a compound role group (`party-demo-alpha__FieldAgent`, `__Reviewer`,
  `__Coordinator`, or `__PartyAdmin`) — not just one.
- **A related but distinct caching gotcha, found 2026-08-04**: right after a
  successful `pipeline-deploy`, a plain (non-cache-busted) request to a
  static asset like `manifest.webmanifest` can still return the *previous*
  deploy's content for a few minutes. Not a failed deploy — Amplify
  Hosting's CDN sets `s-maxage=31536000` on static assets, and a specific
  already-cached URL can take a short while to propagate an invalidation
  across edges after a new deploy, even though the origin already has the
  new content. Confirmed by fetching the same URL with `{cache: 'no-store'}`
  and a cache-busting query string, which returned the correct new content
  immediately. If a just-deployed change looks stale in a browser, re-check
  with a cache-busting fetch before assuming the deploy or the code is
  wrong.

## Operational — not something I can do

- [ ] **Source real PU/Ward/LGA reference data through a licensed/authoritative
  channel.** The current dataset (`src/referenceData/states/*.js`) is
  deliberately synthetic placeholder data. We looked at pulling from
  third-party sites that mirror INEC's PU codes and decided against it —
  no registered-voter counts, uncertain currency/accuracy, and not
  actually from INEC despite the framing. This needs a proper data
  licensing/sourcing conversation, not a scrape job.
- [ ] **Recruit and train field agents.** EC8A capture process, how to use
  the app offline, photo quality expectations (the OCR pre-fill is only
  as good as the photo), what the validation warnings mean and when to
  override them, what happens if their device is lost/stolen mid-election.
- [ ] **Provision real party-client accounts.** For each real party client:
  a Cognito group (`amplify/auth/resource.ts`), a matching S3 storage path
  rule (`amplify/storage/resource.ts`), and an entry in
  `src/referenceData/partyClients.js` — documented as "three touchpoints,"
  and each needs a real name/identity decision, not just a code change.
- [ ] **Legal/compliance review.** Confirm the tool's operation doesn't
  conflict with INEC regulations on independent election monitoring, and
  that agent/photo/GPS data collection has a clear consent and NDPR
  (Nigeria Data Protection Regulation) compliance story.
- [ ] **Data retention policy.** How long are submission photos, GPS
  coordinates, and agent identities kept, and who can access them after
  the election cycle ends? Nothing currently expires or gets archived.
- [ ] **Revisit the $20/month AWS budget** before real use — that threshold
  was set for this dev/test phase. CLAUDE.md's own estimate is "tens of
  dollars per state per election cycle" for real usage.
- [ ] **Test installability on a real low-end Android device.** CLAUDE.md's
  installability requirement explicitly calls for this — "simulated and
  real conditions" can differ, especially for maskable-icon rendering and
  the install-prompt UX. The manifest/icons (2026-08-04, see below) have
  only been verified in a desktop browser and via direct HTTP checks
  against the deployed manifest/icon files — never on an actual phone.

## Product/design decisions — need your call, not just code

- [ ] **Separate agent app vs. dashboard app.** Right now both live in one
  page (a Field Agent / Party Dashboard toggle) for demo convenience. A
  real deployment might want these as genuinely separate apps/URLs,
  matching the original SPEC's intent — worth deciding deliberately
  rather than carrying the combined version forward by default.
- [ ] **MFA for party-dashboard accounts.** Currently `mfa_configuration:
  "NONE"` on the Cognito user pool. Given these accounts can view
  submission evidence and discrepancy data, MFA is worth considering
  before real use, at least for dashboard-role accounts.

## Engineering follow-ups (things I can build, not done yet)

- [ ] **Re-test duplicate detection under realistic burst load.** The load
  test against the real backend (see `scripts/load-test-real-backend.mjs`)
  surfaced a genuine finding: when many submissions for the *same* PU land
  within a couple of seconds of each other, the async DynamoDB Streams →
  Lambda validation pipeline can flag *all* of them as duplicates rather
  than exactly one — a real difference from the synchronous mock-server
  behavior. This is arguably the safer behavior (surfaces everything for
  review rather than confidently picking one), but it's only been tested
  with synthetic same-instant writes, not realistic field timing. Worth
  revisiting once real usage patterns are known.
- [ ] **Multi-state reference data at real scale.** The registry
  (`src/referenceData/states/index.js`) is proven to generalize (Gombe +
  Adamawa), but real data for the full North-East expansion (Bauchi,
  Borno, Taraba, Yobe per CLAUDE.md) hasn't been loaded — blocked on the
  data-sourcing item above.
- [ ] **DynamoDB point-in-time recovery / S3 versioning.** Neither is
  currently enabled. Worth turning on before real submissions accumulate,
  since Submissions are meant to be immutable and irreplaceable.
- [ ] **Wrap `scripts/load-test-real-backend.mjs`'s cleanup in try/finally.**
  Minor hygiene issue flagged during the security review — a crash
  mid-run currently leaves synthetic test records in the real table
  instead of guaranteeing cleanup.
- [ ] **Coordinator has no UI for "flag issues."** CLAUDE.md's role matrix
  (`Coordinator: ... flag issues; cannot edit vote figures directly`) grants
  this permission, but no flagging flow or backend model for it was ever
  built. Today Coordinator/PartyAdmin accounts get read-only dashboard
  access, same as everyone in the tenant — no functionality distinguishes
  them from each other yet, only from FieldAgent (can't create Submissions)
  and Reviewer (can't create Corrections).
- [ ] **Per-agent PU assignment / per-coordinator LGA-ward assignment.** The
  role matrix scopes FieldAgent to "assigned PU(s) only" and Coordinator to
  "their LGA/ward" — narrower than what's enforced today. No data model
  exists for per-agent PU assignment or per-coordinator LGA/ward
  assignment; every role gets tenant-wide read within their party client.
  Building the assignment model is a real feature, not a quick fix — it
  needs its own admin UI (who assigns agents to PUs, and where) before the
  access-control side is even worth tightening.
- [ ] **`REVIEWER_CORRECTION_FLOW_SPEC.md` is stale.** Its data-model
  section still describes a `Correction` type (`correctedFields`,
  `originalSnapshot`, `flagType`) that was never built — the real,
  deployed `SubmissionCorrection` model is narrower (`partyVotes` only).
  The spec's access-control and UI sections are accurate; only that one
  section needs a rewrite pass so a future reader isn't misled by it.

## Already done and verified

Auth (Cognito, group-based tenant isolation, group auto-assignment), data
(AppSync/DynamoDB with server-side validation via DynamoDB Streams →
Lambda), storage (S3 per-party-client photo storage), AWS Budget alert
($20/month, 80% actual + 100% forecasted thresholds), and a security review
of the latest changes (no findings). All verified against the real deployed
backend, not just locally — see commit history for the specific bugs found
and fixed along the way.

CI/CD (`amplify.yml`, GitHub connected via Amplify Hosting console) is live
and has produced a successful end-to-end build + deploy on `master` (backend
CDK deploy + frontend Vite build + deploy, ~10 min). Uses `npm install`
rather than `npm ci` in both phases — `npm ci` failed non-deterministically
on nested `bundleDependencies` inside `aws-cdk-lib`'s toolkit bundle (a known
npm lockfile-writer bug), reproduced identically across repeated clean local
installs. See the "sandbox vs. deployed backend" note above before assuming
anything tested locally is present on the deployed site.

**The reviewer/edit flow** (CLAUDE.md: "edits go through a logged reviewer
flow only") is built and verified end-to-end against **both** the sandbox
and the deployed Amplify Hosting backend (separate backends, see above) —
see `amplify/data/resource.ts`'s `SubmissionCorrection` model,
`amplify/functions/validate-submission/handler.ts`'s second Streams source,
and `src/ui/dashboard/CorrectionForm.jsx`/`CorrectionHistory.jsx`. A
`Submission` row is never mutated; a correction is a new, attributed (real
signed-in email, never typed), reasoned, immutable record layered on top,
server-validated the same way the original submission is. Verified live on
each backend: filed a correction on a real implausible submission (severity
flipped from `error` to `ok` on the correction, computed by the Lambda, not
the client), confirmed the original discrepancy stays listed with a
"corrected" badge rather than disappearing, confirmed both entries appear
in the Audit Log correctly attributed and chronologically ordered, and
confirmed AppSync rejects a cross-tenant query for the new model exactly as
it does for `Submission`. Correction chaining (a second correction's
"previous" value coming from the first correction's new value, not the
original) was verified on the sandbox. Test data from both verification
passes has been deleted from both backends' tables.

**Role-group access control (2026-08-03 / 2026-08-04), replacing the old
`custom:role` UI-only gate entirely.** CLAUDE.md's role matrix
(FieldAgent/Coordinator/Reviewer/PartyAdmin) is now real, party-scoped
Cognito group membership (`amplify/auth/resource.ts`'s compound groups,
`${partyClientId}__${role}`), read via `src/auth/useMyRoleGroups.js`. This
directly resolves the "Enforcement is UI-only" design call this file used
to flag as an open question — it's no longer open. Two real gaps were
found and closed along the way, not just theorized:
- **A Lambda-authorizer approach was tried first and is not viable on this
  API** — AppSync classifies a genuine Cognito access token as `userPool`
  auth unconditionally, before checking any field-level `@aws_lambda`
  directive, so a signed-in user's own token can never route through a
  custom authorizer here. Confirmed live (direct Lambda invoke succeeded,
  raw `curl` straight to AppSync never even reached the function) before
  abandoning it for compound groups instead.
- **A client-supplied `requiredCreatorGroup` field could be honestly
  misclaimed.** `groupDefinedIn` only checks the caller is a real member of
  *whatever group name is in the field* — it couldn't tell "the group this
  operation requires" from "any group I honestly belong to," so a real
  FieldAgent could claim their own group on a `SubmissionCorrection` create
  and be authorized. Confirmed empirically, then closed for real: creation
  now goes entirely through two custom mutations
  (`fileSubmission`/`fileCorrection`) backed by
  `amplify/functions/create-role-checked-record/handler.ts`, which checks
  the caller's REAL Cognito group membership (`event.identity.groups`,
  populated by AppSync itself) — there is no client-supplied field left to
  misclaim. The model's own `create` mutations are now permanently
  unreachable, same as `update`/`delete` always were.
- **`reviewerNote: ''` was accepted** — `a.string().required()` only
  rejects null/absent, not empty. Closed with a `minLength(1)` Validate
  Transformer rule (real server-side enforcement) plus a matching check in
  the Lambda above (the transformer doesn't reach custom-mutation
  arguments).

All three were verified against the real, live sandbox AND production APIs
(not just typechecked) — see commit history (`git log --oneline` around
2026-08-03/04) for the specific scripted and browser-driven checks run
against each. Test accounts and records created for production
verification were deleted afterward; production Cognito pool and DynamoDB
tables were confirmed clean.

**VerifiVote branding / PWA installability (2026-08-04).** The manifest's
`icons: []` placeholder (present since installability was first added to
this checklist) is filled in — real icons at all standard sizes plus
maskable variants, app renamed from the placeholder "Election Result
Verification Platform" / "ResultTracker" to "VerifiVote" in the manifest,
apple-touch-icon and favicon `<link>` tags added to `index.html`. Verified
in a desktop browser (icons load, no console errors) and via direct HTTP
checks against the deployed manifest/icon files — **not yet on a real
device**, see the Operational section above.

One live-testing gotcha worth remembering (from before the role-group
work, may still apply to other custom Cognito attributes): after changing
a user attribute via `admin-update-user-attributes`, an already-open
browser tab needs a full page reload, not just an in-app sign-out/sign-in,
to pick up the new claim — the in-SPA re-login reused a cached session
token.

One design call from the original version of this file is still genuinely
open (not resolved by the role-group work above):
- **Single-actor, immediate correction — no two-person approval step.** One
  Reviewer-role user files a correction with a mandatory reason; that
  itself is treated as "the logged reviewer flow." Not built: a
  propose/approve two-actor workflow with a pending state. If this should
  actually be the two-actor version, that's a real follow-up, not a bug —
  say so and it can be built.
