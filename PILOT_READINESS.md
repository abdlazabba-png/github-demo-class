# Pilot Readiness Checklist

What a real Gombe State pilot needs beyond what's built. Organized by who owns
each item — most of this is **not** an engineering task, and this file exists
so that's explicit rather than left implicit. Written 2026-07-30, after the
core platform (auth, data, storage, server-side validation, group
auto-assignment, CI/CD, budget monitoring) was built and verified end-to-end
against the real AWS backend.

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

## Product/design decisions — need your call, not just code

- [ ] **A reviewer/edit flow.** CLAUDE.md requires "edits go through a
  logged reviewer flow only" — this doesn't exist. Submissions are
  currently create+read only with no update path at all, which is safe
  (nothing can be silently changed) but also means a genuine data-entry
  error caught after submission has no correction path yet.
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

## Already done and verified

Auth (Cognito, group-based tenant isolation, group auto-assignment), data
(AppSync/DynamoDB with server-side validation via DynamoDB Streams →
Lambda), storage (S3 per-party-client photo storage), CI/CD build spec
(`amplify.yml`, needs the GitHub connection step in the AWS Console), AWS
Budget alert ($20/month, 80% actual + 100% forecasted thresholds), and a
security review of the latest changes (no findings). All verified against
the real deployed backend, not just locally — see commit history for the
specific bugs found and fixed along the way.
