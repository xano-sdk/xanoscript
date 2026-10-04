# @xano-sdk/xanoscript

Renders a [Xano SDK](https://github.com/xanots/sdk) workspace to **XanoScript** —
the language the Xano engine actually runs.

> **Status: 1.0.x.** A toolchain module for the Xano SDK (`@xano/sdk` `>=1.0.0 <2.0.0`):
> the emitter and the `./plugin` entry the CLI loads.

## Use it

```bash
npx xanosdk marketplace install @xano-sdk/xanoscript
npx xanosdk export ./xano/index.ts --out workspace.json   # also writes xanoscript/
npx xanosdk export ./xano/index.ts --check                # fails when xanoscript/ is stale
```

This is a toolchain module: it extends the CLI and adds nothing to the workspace, so there
is nothing to register in `xano/index.ts`. The install asks two questions (commit the tree,
and where), answerable by flag when there is no terminal (`--no-xanoscript`, `--xanoscript-dir=<dir>`),
and records them in the project's `package.json` `"xanosdk"` block. From then on every
`xanosdk export` writes one `.xs` file per object plus a `README.md` into the tree,
`export --check` (or `--frozen-lock`) compares without writing, and `xanosdk preflight`
adds a comparison of the emitter against the engine's own rendering. A run given
`--bundle` instead of an entry file writes nothing, because the tree describes the
source beside it.

## What it is

The emitter is a **file-for-file port of the Xano engine's own JSON → XanoScript
encoder**, pinned to one engine commit. Its contract is not "looks right" — it is
**byte equality with the engine**, proven against 1,280 of the engine's own
golden fixtures on every run.

That is what makes a committed `xanoscript/` tree worth reading: a backend change
shows up in review as the XanoScript the engine will run, one file per object,
beside the TypeScript that produced it.

## Quick start (maintainers)

```bash
npm install
npx vitest run            # the full suite, corpus included
npm run xs:report         # the corpus, as pass/fail counts grouped by reason
npm run typecheck
npm run lint
```

`npm run xs:report` should print **1279 passed, 1 failed** — that one failure is
a documented corpus artifact, recorded with its reason in
`test/corpus-known-failures.json`.

## Layout

| Path | What it is |
|---|---|
| `src/index.ts` | the emitter entry (`emitXanoScript`, `createScriptContext`) |
| `src/engine/` | the encoder core — parsers, kinds, values, coercion semantics |
| `src/transform/` | one class per statement kind |
| `src/multidoc.ts` | workspace → multidoc assembly |
| `src/tree.ts` | multidoc → one-file-per-object placement |
| `src/writer.ts` | the committed `xanoscript/` tree: write, check, README, placeholders |
| `src/render-def.ts` | one def rendered alone — the only file needing the `@xano/sdk` peer |
| `src/diff.ts` | document-aware comparison of two multidocs |
| `vendor/xs-engine/` | generated engine data and the commit lock (never hand-edited) |
| `scripts/xs-engine/` | the drift loop — vendor, sync, drift, report |

## The emitter takes no peer

Everything under `src/` imports nothing from `@xano/sdk` except
`render-def.ts`. The `.` entry builds and its suite passes with the peer absent,
and `test/peer-free.test.ts` asserts it. That isolation is why this package can
follow the engine's release cadence instead of the SDK's.

## Contributing

Read `AGENTS.md` in the repository first — **especially the disclosure block at
the top**. It carries the drift loop, the porting order, the coercion-semantics
rule, and the redaction procedure for a credential found in the corpus.

`AGENTS.md` is deliberately NOT in the published tarball: it describes the
engine's internal layout, which belongs in the repository and not on a public
registry. See the disclosure block for what that constrains.

## License

MIT
