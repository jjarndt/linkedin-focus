# Security Policy

## Supported versions

Security fixes are provided for the versions listed below. Older versions
receive no fixes and no advisories.

| Version | Supported |
| ------- | --------- |
| 1.0.x | Yes |
| Older | No |

## Reporting a vulnerability

Please do not open a public issue for a security problem, and do not disclose
it in Discussions or on social media before a fix is available.

**Preferred channel: private vulnerability reporting on GitHub.**

Use the "Report a vulnerability" button on the Security tab:
https://github.com/jjarndt/linkedin-focus/security/advisories/new

This creates a private advisory draft. The report, the discussion and any draft
patch stay private until the advisory is published.

**Fallback: email.** If you cannot use GitHub, write to
63701064+jjarndt@users.noreply.github.com. Plain email is not encrypted, so keep
the initial message short: what is affected, and how it can be reproduced.
Details can follow in the private advisory.

## What to include

A report is most useful when it contains:

- Affected version, macOS version and Safari version
- A reproducer: the smallest page state, setting or code that triggers the issue
- The impact you observed, not only the pattern you suspect
- Any preconditions, for example a specific toggle state or LinkedIn locale

A reproducer is the single most valuable part of a report. Without one, the
work of establishing whether the problem is real moves to the receiving end.
Reports that only assert that something looks vulnerable, with no way to
confirm it, may be closed without a detailed reply.

Reports generated with the help of automated tools or language models are
welcome, provided they are verified. What matters is whether the problem is
real and reproducible, not how it was found. Unverified tool output submitted
as-is will be closed.

## What happens next

This project is in maintenance mode. It works, and it is touched when it needs
touching. There is no time budget allocated to it, no service level agreement,
and therefore no promised first-response time and no promised time to a fix.
Stating a number here that is not backed by anything would be worse than
stating none, so none is stated.

What is committed to, without a deadline attached:

- Reports are read.
- A confirmed report is either fixed or answered with a clear statement that it
  will not be fixed, rather than left silent.
- Fixes are prepared in a private fork attached to the advisory, then released
  and the advisory is published.
- The advisory names a fixed version before publication, so that dependency
  scanners can point users at an upgrade path rather than only an alert.
- Reporters are credited in the advisory unless they ask not to be.

If you need a reaction within a defined window, this project cannot give you
one. The licence permits forking, and forking is the correct move in that case.

LinkedIn Focus does not operate a bug bounty and does not pay for reports.

## Scope

In scope: the code in this repository, that is the extension sources under
`extension/` and the helper scripts shipped alongside them.

Out of scope:

- Vulnerabilities in LinkedIn itself. This extension only restyles pages
  locally in your own browser; report LinkedIn issues to LinkedIn.
- Vulnerabilities in Safari, macOS or the Safari Web Extension conversion
  toolchain without a demonstrated impact on this project. Report those to the
  respective vendor.
- Vulnerabilities in third-party development dependencies (the test harness)
  without a demonstrated impact on the shipped extension. Nothing under
  `node_modules/` is part of the released extension.
- Findings that require an already compromised machine, browser profile or
  account.
- Reports produced solely by an automated scanner, with no verification.
