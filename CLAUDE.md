# Election Result Verification Platform — Project Brief

Read this file in full before starting any work. It defines the product,
architecture decisions, and non-negotiable rules for this project.

## What this is

An offline-first mobile PWA + cloud backend that lets field agents at
individual polling units capture and submit certified election result
sheets (Form EC8A) as votes are counted. Submissions sync automatically
once network connectivity is available. Party clients view results on a
web dashboard.

Pilot state: Gombe State, Nigeria (~2,988 polling units). Target
expansion: North-East Nigeria (Adamawa, Bauchi, Borno, Taraba, Yobe).

## Positioning — read this before writing any product copy or UI text

This is a **neutral, independent verification tool** licensed
confidentially to any political party client — not a tool built around
one party or one narrative. This shapes real product rules, not just
marketing:

- **Never display a live "who's winning" number or leaderboard.**
  Any aggregate view must be framed as "unofficial, N of N polling
  units reporting" — never as a result.
- **Strict data isolation between party clients.** One party's client
  must never be able to query, see, or infer another party's data.
  Enforce this at the access-control layer, not just the UI.
- Submissions are agent-attributed and auditable — never anonymous,
  never silently editable after submission (edits go through a logged
  reviewer flow only).

## Tech stack (decided — do not re-litigate without discussion)

- **Backend:** AWS Amplify (Gen 2) + AppSync/DataStore for offline-first
  sync, DynamoDB for submission metadata, S3 for result-sheet photos.
- **Why AWS over Firebase:** keeps this isolated from existing client
  work already running on other infrastructure, and builds on prior
  hands-on AWS experience (S3, CloudFront, API Gateway, Lambda,
  DynamoDB from a prior deployed project).
- **Client:** offline-first mobile PWA — local IndexedDB/SQLite queue,
  background sync, works fully offline for capture (only sync requires
  connectivity).
- **OCR:** on-device OCR (ML Kit or Tesseract) to pre-fill vote figures
  from the photographed sheet — always shown to the agent for manual
  confirmation before submission. Never auto-submit OCR output as
  ground truth.

## Build sequence — follow this order, do not skip ahead

1. **Phase 1 — Offline-sync proof of concept (build and test this
   first, in isolation, before any other feature).**
   Test explicitly for: airplane mode during capture, app killed
   mid-sync, device restart before sync completes, delayed reconnect
   after hours offline, throttled 2G. Zero data loss and no duplicate
   submissions in every scenario. Write these as automated tests, not
   manual QA steps.
2. **Phase 2 — MVP:** agent capture flow, validation pipeline
   (OCR-vs-manual mismatch, vote-count-vs-registered-voters
   plausibility checks, duplicate detection), party dashboard
   (coverage view, evidence view linked to source photos, discrepancy
   queue, audit log).
3. **Phase 3 — Pilot:** small agent group, real or simulated election,
   load-test the dashboard and sync layer under concurrent submission.
4. **Phase 4 — Commercialize / multi-state:** parameterize the PU/Ward/
   LGA reference data per state instead of hardcoding Gombe.

## Data model notes

- Reference data (PU/Ward/LGA hierarchy, registered voters per PU) is
  versioned and loaded per state — bundled client-side so agents can
  select their PU with zero network.
- Submission record shape (draft — refine in Phase 1):
  `{ agentId, puCode, wardCode, lgaCode, partyVotes{}, ocrVotes{},
  photoUrl, gps, timestamp, deviceId, submissionHash }`
- `submissionHash` computed at ingestion for tamper-evidence — pair it
  with the original photo, never trust the hash alone.

## Infra/cost guardrails

- Serverless only (Lambda, DynamoDB on-demand, S3) — no always-on
  servers. Expected cost is low (tens of dollars per state per
  election cycle) as long as this stays serverless.
- Set an AWS Budget alert on this project's environment before any
  real election use.

## What NOT to do without asking first

- Don't touch AWS credentials or run deploy/apply commands — propose
  the change, wait for confirmation, then I'll run it myself.
- Don't integrate with or represent this as connected to INEC's
  official systems (BVAS/IReV) — this is an independent tool.
- Don't build any public-facing result display — party-client
  dashboards only, behind auth.
