# Repository handoff instructions

These instructions apply to the whole repository.

## Before construction

1. Read `docs/SDD.md` and `docs/sdd/README.md` before changing product behavior, architecture, data, UI, deployment, or calibration.
2. Find the relevant work-package SDD. If none exists, copy `docs/sdd/TEMPLATE.md` and create one before implementation.
3. A `Proposed` SDD is context, not authorization. Do not start it until the user accepts the scope.
4. Preserve unrelated user changes and never commit secrets, local IndexedDB data, private photos, API tokens, PIN plaintext, or personal calibration records.

## Product invariants

- The app is local-first and has no backend by default.
- Voice, photo, and board tapping are equal primary input paths.
- User-facing copy is Taiwan Traditional Chinese; Chinese Xiangqi branding must not use Western-chess symbols as the product mark.
- Rank labels are Taiwan-style relative levels. Do not expose internal Western-chess Elo or imply association certification.
- Rank calibration is local-only, hidden, and PIN-gated until a later SDD explicitly changes that decision.
- Push and production deployment are separate. Never deploy without an explicit user request.

## Definition of done for authorized construction

1. Update the work-package SDD and the master SDD when decisions or architecture change.
2. Run tests proportional to the change, then run `npm test` and `npm run build` unless a documented blocker prevents it.
3. Inspect `git diff`, `git diff --check`, and `git status --short`; include only the intended scope.
4. Record verification evidence and remaining limitations in the work-package SDD.
5. Commit completed construction with a clear message and push the current branch to its configured remote, as requested by the repository owner.
6. If commit or push cannot complete, report the exact blocker and leave the working tree in a safe, reviewable state.

Advice, diagnosis, planning, and review-only requests do not authorize code changes, commits, pushes, or deployment.
