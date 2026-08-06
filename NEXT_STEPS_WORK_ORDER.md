# VerifiVote — Next Steps Work Order

Consolidated from the pilot readiness review (2026-08-04/05) and the
app-split decision. Ordered by priority — work top to bottom unless
something blocks progress, in which case skip down and come back.

## Decided — ready to build

### 1. Split into separate agent app and dashboard app
Decision: keep one repo, shared auth/data/component layer, but build two
genuinely separate entry bundles.

- Field-agent bundle: capture, offline queue, sync, installable PWA using
  the VerifiVote icon set. No dashboard code included.
- Dashboard bundle: Coordinator/Reviewer/PartyAdmin views. No offline/
  install requirement.

Prompt for Claude Code:
> Split the combined app into two separate entry bundles from the same
> repo: a field-agent PWA (capture, offline queue, sync — installable,
> using the VerifiVote icon set) and a dashboard web app (Coordinator/
> Reviewer/PartyAdmin views — no offline/install requirement). Share the
> auth and data layer between them rather than duplicating it. Confirm the
> agent bundle's size drops meaningfully once dashboard-only code is
> excluded, and re-run the installability check on both a browser and a
> real device once split.

Do this **before** the pilot, not after — retrofitting the split later
means re-testing everything that currently assumes one combined app.

### 2. Correction approval: single-actor for pilot, two-actor before commercial use
Decision: keep the current single-actor Reviewer correction flow for the
Gombe pilot. Two-actor propose/approve is a deliberate Phase 4
(commercialization) requirement, not an oversight.

Action: update CLAUDE.md to state this explicitly, so it reads as a
decided trade-off rather than an open gap:
> Correction approval is single-actor for the pilot phase — one Reviewer
> files a reasoned, logged correction, which itself satisfies "the logged
> reviewer flow." A two-actor propose/approve model (independent
> corroboration before a correction takes effect) is planned before
> real commercial/multi-party use, not yet built. This is a deliberate
> sequencing choice, not a gap.

## High priority — do next

### 3. Deploy and verify roster/assignment work on production
The PU/ward scoping model (FieldAgent "assigned PU(s) only", Coordinator
"their LGA/ward") is built and verified on sandbox only. Every other
recent change was verified on both sandbox and production — this one
hasn't been yet.

Prompt for Claude Code:
> Deploy the roster/assignment work (AgentAssignment model, createAssignment
> mutation, RosterView.jsx) to production via pipeline-deploy. Re-run the
> same fail-open→fail-closed verification checks against the live production
> API that were already run on sandbox, including the browser-driven check
> (Coordinator sees only their assigned ward's submissions). Report results.

### 4. Real-device installability test
Cheap to do, not yet done. Everything so far has been verified in a
browser or via direct HTTP checks — never on an actual phone.

Action (not engineering): install the field-agent PWA on a real low-end
Android device once the app split (#1) is live. Check: install prompt
appears, home-screen icon renders correctly (including the maskable
variant — simulators can render adaptive-icon masking differently from
real devices), app opens full-screen without browser chrome.

### 5. Real PU/Ward/LGA reference data sourcing
Longest lead time of anything outstanding — start this conversation now,
independent of what else is in progress. Current dataset is placeholder/
synthetic. Needs a licensing/sourcing conversation (INEC directly, or a
CSO like Yiaga Africa with verified datasets), not a scrape job.

### 6. Legal/NDPR compliance review
Pair with the NDPC enquiry already sent. Gates whether agent GPS/photo
data collection can proceed at all for a real election.

## Medium priority — needed before real pilot, not blocking other work

- **Revisit AWS budget threshold** — still set at $20/month dev-level;
  CLAUDE.md's own estimate is "tens of dollars per state per election
  cycle" for real usage.
- **Data retention policy** — how long submission photos, GPS, and agent
  identities are kept, and who can access them after an election cycle.
  Nothing currently expires or archives.
- **MFA for dashboard accounts** — currently `mfa_configuration: "NONE"`.
  Worth enabling at least for Reviewer/PartyAdmin roles given what those
  accounts can see.
- **Rewrite `REVIEWER_CORRECTION_FLOW_SPEC.md`'s stale data-model section**
  — describes a `Correction` type that was never built; the real
  `SubmissionCorrection` model is narrower (`partyVotes` only). Access
  control and UI sections are accurate; only that one section is wrong.

## Lower priority — real but not urgent

- Re-test duplicate detection under realistic (non-synthetic) burst timing
  once real field usage patterns exist.
- Load full North-East reference data (Bauchi, Borno, Taraba, Yobe) —
  blocked on #5 above regardless.
- Enable DynamoDB point-in-time recovery / S3 versioning.
- Wrap `scripts/load-test-real-backend.mjs`'s cleanup in try/finally.

## Operational (not engineering) — running in parallel

- Recruit and train field agents (EC8A capture, offline app use, photo
  quality, validation-warning meaning, lost/stolen device protocol).
- Provision real party-client accounts once a first real client is signed
  (three touchpoints: Cognito group, S3 storage rule, partyClients.js
  entry — follow PARTY_REGISTRATION_RUNBOOK.md).
