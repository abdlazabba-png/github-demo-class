# Reviewer Correction Flow — Build Spec for Claude Code

Paste this file's content (or reference it) into a Claude Code session in the
VerifiVote project. It assumes CLAUDE.md and the existing auth/data model are
already in context.

## Prompt to give Claude Code

> Implement the reviewer correction/edit flow described in CLAUDE.md and in
> REVIEWER_CORRECTION_FLOW_SPEC.md. Submissions must remain immutable —
> corrections are new, linked records, never overwrites. Show me the schema
> change and access-control rules before writing implementation code. Reuse
> the existing Reviewer role/group from the auth model rather than creating
> a new one. After building, walk through the verification checklist at the
> bottom of the spec and report the actual result of each check.

---

## Why this exists

Submissions are currently create+read only — safe (nothing can be silently
changed) but incomplete, since a genuine data-entry error caught after
submission has no correction path. CLAUDE.md already requires "edits go
through a logged reviewer flow only." This spec defines that flow.

## Core rule — do not compromise on this

**The original submission is never overwritten or deleted.** A correction is
a new record, linked to the original, that supersedes it for display
purposes while the original remains permanently visible in the audit trail.
This is what makes the platform's evidence defensible if a result is ever
disputed — a visible correction is a strength, not something to hide.

## Data model

Add a `Correction` record type, separate from `Submission`:

```
Correction {
  id
  submissionId        // links to the original, unchanged Submission
  reviewerId           // who made the correction — must resolve to a
                        // verified Reviewer-role user, not any user
  correctedFields       // only the fields being changed, e.g. { partyVotes: {...} }
  reason                // required free-text — reviewer must explain why
  originalSnapshot       // copy of the affected fields as they were,
                        // captured at correction time, for easy diffing
  timestamp
  flagType              // which flag triggered this (OCR mismatch,
                        // plausibility, duplicate) if applicable, or "manual"
}
```

- A submission can have zero, one, or multiple corrections over time — each
  is its own logged record, not a replacement of the last.
- The **current effective value** for any field is: latest correction's
  value for that field, or the original submission's value if never
  corrected. Compute this at read time — don't denormalize it onto the
  Submission record itself, or you reintroduce the "silently editable"
  problem this flow exists to prevent.

## Access control

- Only users in the **Reviewer** group/role (already defined in the auth
  model per CLAUDE.md's role matrix) can create a Correction.
- A Reviewer can only create corrections for submissions within their own
  party's tenant scope — reuse the same isolation rule already enforced on
  Submission reads.
- Field Agents, Coordinators, and Party Admins can **view** corrections
  (it's part of the audit trail) but cannot create them.

## UI requirements

**Reviewer-facing:**
- From a flagged submission (or any submission, for manual corrections),
  a "Correct this submission" action opens a form showing: the original
  photo, the original values, and editable fields for the corrected values.
- The `reason` field is required — do not allow submission without it.
- On save, show a clear confirmation that this creates a new logged
  correction, not an edit to the original.

**Evidence/audit view (all authorized roles):**
- A submission with corrections should visibly show both: the original
  values and every correction applied since, in chronological order, each
  attributed to its reviewer and timestamped.
- Do not collapse this into just "the latest number" — the whole history
  needs to stay visible, not just be available if someone digs for it.

## What NOT to build

- No raw update/edit endpoint on the Submission record itself.
- No way for a Reviewer to delete or hide a correction once made.
- No silent auto-application of a correction without a `reason`.

## Verification checklist — run through this after building

- [ ] Attempting to directly mutate a Submission record (bypassing the
      Correction flow) fails at the access-control layer, not just the UI.
- [ ] A Correction created by Party A's reviewer is invisible to Party B,
      same as Submissions.
- [ ] A submission with two sequential corrections shows both, in order,
      with the original still intact and visible.
- [ ] Attempting to create a Correction with no `reason` is rejected.
- [ ] A non-Reviewer role (test with Field Agent and Party Admin accounts)
      cannot create a Correction, only view existing ones.
- [ ] The "current effective value" shown on the dashboard reflects the
      latest correction, while the audit/evidence view still shows full
      history.
