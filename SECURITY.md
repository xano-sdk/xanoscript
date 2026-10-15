# Security policy

## Reporting a vulnerability

Report it privately, not in a public issue:

**[Open a private security advisory](https://github.com/xano-sdk/xanoscript/security/advisories/new)**

Include what you found, how to reproduce it, and what an attacker could do with
it. A proof of concept helps; a redacted one is fine.

We will acknowledge the report and keep you updated as we work through it. We
are a small team and do not promise a fixed response window — if you have not
heard anything after a week, please ping the advisory thread.

Please give us a chance to ship a fix before disclosing publicly. We will credit
you in the release notes unless you would rather we did not.

## Supported versions

Only the latest published `@xano-sdk/xanoscript` release receives fixes. There
are no maintained release branches — upgrade to the newest version to pick up
security patches.

## Scope

This policy covers the `@xano-sdk/xanoscript` package and this repository,
including the `xanoscript/` tree it writes into your project.

The `xanosdk` CLI and `@xano/sdk` have their own policy in
[xano-sdk/sdk](https://github.com/xano-sdk/sdk). Vulnerabilities in the Xano
platform itself are out of scope here — report those through Xano's own security
channels.

## Sharing renderings

A rendered `.xs` file carries what your workspace defines, including default
values and literals in your functions. Redact secrets and instance URLs before
pasting one into an issue.
