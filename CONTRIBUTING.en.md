> 🌐 [Version française](./CONTRIBUTING.md) · **English**

# Contributing to BALDR

Thanks for your interest! BALDR is stewarded by Malakoff Humanis.

## Licensing of contributions

By submitting a contribution (pull request), you agree that it is distributed under the project's
**Apache-2.0** license (inbound = outbound, per section 5 of the Apache-2.0 license).

## Branching model

We use a trunk-based model centered on `main`:

- All pull requests target **`main`**.
- Create short-lived branches named after Conventional Commits types:
  `feat/*`, `fix/*`, `docs/*`, `chore/*`, `refactor/*`.
- `main` is protected: no direct pushes, green CI required, at least one
  maintainer review (CODEOWNERS).
- Releases are tagged on `main` via `npm version <patch|minor|major>`.

## Workflow

1. Fork the repo (or create a branch if you are a maintainer).
2. `npm ci`, then code. Keep changes focused.
3. Use **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`).
4. Run `npm run check` (lint + typecheck + tests) locally before pushing.
5. Open a PR targeting `main`. Fill in the PR template.
6. Address review feedback. A maintainer squash-merges once approved.

## Proposing a feature

Open a "Feature Proposal" issue. Non-trivial features (API contract, report
format, security model, new dependency/provider) follow the RFC process in
[GOVERNANCE.md](./GOVERNANCE.en.md).

## Code of Conduct

This project follows the [Code of Conduct](./CODE_OF_CONDUCT.en.md).
