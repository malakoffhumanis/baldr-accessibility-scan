> 🌐 [Version française](./GOVERNANCE.md) · **English**

# Governance

BALDR is an open-source project stewarded by Malakoff Humanis (MH).
Model: **sponsored open source** — development is open and transparent, while
final decision authority remains with the MH maintainer team.

## Roles

| Role | Who | Rights |
| --- | --- | --- |
| Contributor | Anyone | Open issues / PRs |
| Triager | Trusted contributor (held in reserve) | Triage and label issues |
| Committer | Regular contributor (held in reserve) | Merge PRs on a limited scope |
| Maintainer | MH employees / contractors | Merge, release, repo admin |
| Technical Lead | Vincent RICHARD | Final RFC decision, tie-break, vision |

Triager and Committer roles are defined but **inactive at launch**; they will be
opened to external contributors at the 12-month review (2027-06-18).

## Decision making (features)

Non-trivial features follow a lightweight RFC:

1. Open a "Feature Proposal" issue (problem, proposal, alternatives, security impact).
2. Public discussion, minimum 5 business days.
3. Decision: **Technical Lead + agreement of at least 2 maintainers**. Ties are broken by the Technical Lead.
4. The MH roadmap is prioritized quarterly; public items carry the `roadmap` label.

Small fixes and docs do not require an RFC.

## Becoming a maintainer

Strong contribution does not automatically grant maintainer status. A documented
promotion path (Triager → Committer → Maintainer) opens at the 12-month review,
based on PR quality and volume, review reliability, and Code of Conduct adherence.

## Security

See [SECURITY.md](./SECURITY.en.md). Vulnerability reports are validated and triaged
privately by the MH SecOps team via GitHub Security Advisories.
