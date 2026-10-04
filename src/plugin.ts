/**
 * `@xano-sdk/xanoscript/plugin` — the toolchain module the SDK loads.
 *
 * This is the ONLY file in the repo that faces `@xano/sdk`, and everything it
 * does is glue: it answers the questionnaire, contributes the two
 * `.gitattributes` lines, and wires the emitter's own `writer.ts` / `diff.ts`
 * into the SDK's `onBundle` and `onPreflight` fire points. No rendering
 * decision is made here.
 *
 * The SDK finds it through this package's manifest:
 *
 *     "xanosdk": { "kind": "toolchain", "plugin": "./dist/plugin.js" }
 *
 * and per-project settings come back through `ctx.config` — the block
 * {@link contributes} produced, which {@link answersFromConfig} reads back the
 * next time the project is reconciled.
 */
import { relative } from "node:path";
import type { BundleContext, HookResult, PluginAnswers, PreflightContext, ProjectContributions, ToolchainPlugin } from "@xano/sdk/plugin";
import { apiGroupIdentity, diffMultidocs, diffsFor, type DocDiff } from "./diff.js";
import { emitWorkspaceMultidoc } from "./multidoc.js";
import { OptionsError, PACKAGE_NAME, resolveOptions } from "./options.js";
import {
  checkXanoScriptTree,
  DEFAULT_TREE_DIR,
  emitBundleXanoScript,
  placeholderWarning,
  projectTreeScripts,
  writeXanoScriptTree,
  type TreeProvenance,
} from "./writer.js";

// ─────────────────────────────────────────────────────────────────────────────
// The peer range
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `@xano/sdk` versions this module is correct against, matching the
 * `peerDependencies` range in `package.json`. The two must be kept in step by
 * hand; the test suite asserts they are.
 *
 * The floor is the first SDK whose toolchain contract this module speaks:
 * {@link ToolchainPlugin.contributes} and {@link ToolchainPlugin.answersFromConfig}.
 * Every hook on that contract is optional, so a module speaking one version of
 * it to a loader that speaks another REGISTERS AND CONTRIBUTES NOTHING, in
 * silence — "a module with no contributions" being a legitimate outcome.
 */
const MIN_SDK = "1.0.0";
/** Exclusive upper bound. The range is widened deliberately, one major at a time. */
const MAX_SDK_EXCLUSIVE = "2.0.0";

/** The range as `package.json` spells it, so one edit cannot move without the other. */
export const PEER_RANGE = `>=${MIN_SDK} <${MAX_SDK_EXCLUSIVE}`;

/** `1.2.3-beta.1` → `[1, 2, 3]`; anything unparsable yields null. */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Refuse, by name and before any work, an SDK this module does not understand.
 *
 * The install-time peer warning cannot carry this: the peer is declared
 * non-optional precisely so npm prints one, but a warning during `npm install`
 * is read by nobody three weeks later, and the failure it describes is SILENT —
 * an older SDK has no toolchain loader at all, so the hook simply never fires
 * and the tree quietly stops being written. A hook that DID fire on a version
 * outside the range is the case this catches: the shapes it is handed are not
 * the shapes it was written against.
 *
 * An unparsable version, or one carrying a PRERELEASE suffix, is allowed
 * through. The SDK reads the version from its own `package.json`, and a source
 * checkout reads `0.0.0-dev` — refusing that would break exactly the linked
 * development setup KTD5 asks for. The cost is that a prerelease of an
 * out-of-range SDK is not caught, which is the trade npm's own ranges make.
 *
 * ── Two layers ──────────────────────────────────────────────────────────────
 *
 * The SDK's loader reads this package's own `peerDependencies["@xano/sdk"]`
 * and refuses an out-of-range SDK during discovery, before this file is even
 * imported — so the failure is caught at the moment that actually needed it.
 * The hooks here run at `export` / `deploy` / `preflight`, which is far too late
 * for a RECONCILE (`init`, a later install, a re-ask) that quietly contributed
 * nothing; the loader-side check is what closes that.
 *
 * This check is the backstop for any path that reaches a hook without having
 * gone through discovery.
 *
 * The two layers agree on the prerelease trade rather than fighting over it:
 * the SDK's own range test returns "unknown" for a prerelease and refuses only
 * on a definite false, so `0.0.0-dev` passes both, and the linked development
 * setup keeps working on either side.
 */
export function assertSdkVersion(sdkVersion: string): void {
  if (sdkVersion.includes("-")) return;
  const found = parseVersion(sdkVersion);
  if (found === null) return;
  const min = parseVersion(MIN_SDK)!;
  const max = parseVersion(MAX_SDK_EXCLUSIVE)!;
  if (compare(found, min) < 0 || compare(found, max) >= 0) {
    throw new OptionsError(
      `${PACKAGE_NAME} requires @xano/sdk ${PEER_RANGE}, but ${sdkVersion} is running. ` +
        `Upgrade @xano/sdk, or remove ${PACKAGE_NAME} from this project — the XanoScript tree is not written by an SDK outside that range.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile: questions, contributions, and reading the answers back
// ─────────────────────────────────────────────────────────────────────────────

/** The answer key for "commit the tree at all". */
const Q_ENABLED = "xanoscript";
/** The answer key for "where does it go". */
const Q_DIR = "dir";

const questions = [
  {
    id: Q_ENABLED,
    label: "Commit a XanoScript rendering of the backend, so changes review as what the engine runs",
    type: "boolean",
    default: true,
  },
  {
    id: Q_DIR,
    label: "Directory for the XanoScript tree",
    type: "string",
    default: DEFAULT_TREE_DIR,
    // Derived from `id` this would be `--dir`, which reads as the SDK's own
    // and would collide with the next module that wants a directory. The flag
    // is namespaced to the thing it configures.
    flag: "xanoscript-dir",
    // A project that declined the tree is never asked where to put it, and —
    // per the contract — the unasked question's default is NOT written to the
    // config block either. Recording `dir` for a disabled module would put a
    // directory nobody chose in front of the next reader.
    when: (answers: PluginAnswers) => answers[Q_ENABLED] !== false,
  },
] as const;

/** The config key recording whether the tree is written at all. */
const C_ENABLED = "enabled";
/** The config key recording where it goes. */
const C_DIR = "dir";

/**
 * What the project gets. Two gitattributes lines and the config block, and
 * nothing else: no CI step, because the SDK's own `--frozen-lock` export is
 * what fails on a stale tree and the workflow already runs it.
 *
 * PURE, and called on every reconcile rather than once at `init` — installing
 * this module into a project that already exists, re-answering its questions,
 * and removing it again all run it. So the returned contributions must be a
 * function of the answers alone: no filesystem, no knowledge of which command
 * is running, and the same result every time. The SDK writes the lines into a
 * marked block of its own, which is what lets a re-answer rewrite exactly this
 * module's span and nothing around it.
 *
 * The EMPTY return for a declined project is therefore meaningful, not a
 * shrug: it removes the block rather than leaving an empty one, so a project
 * that turned the tree off stops carrying rules it declined.
 *
 * The comments go into the user's `.gitattributes` on purpose. Both lines look
 * like noise a tidy-up would delete, and both have a specific reason that is
 * not recoverable from reading them.
 */
function contributes(answers: PluginAnswers): ProjectContributions {
  if (answers[Q_ENABLED] === false) return {};
  const dir = typeof answers[Q_DIR] === "string" && answers[Q_DIR] !== "" ? (answers[Q_DIR] as string) : DEFAULT_TREE_DIR;
  return {
    gitattributes: [
      "",
      '# GitHub\'s built-in ".xs" language is Perl XS (tm_scope: source.c), so without',
      "# this every XanoScript file renders with C syntax highlighting and counts as",
      "# Perl XS in the repository language bar. HCL is the closest built-in match to",
      "# XanoScript's `block name { key = value }` grammar with // comments.",
      "*.xs linguist-language=HCL",
      "",
      `# ${dir}/ is generated but committed on purpose: a backend change is`,
      "# reviewed as the XanoScript it produces. Deliberately NOT linguist-generated:",
      "# that is the one attribute that COLLAPSES a file in pull request diffs, which",
      "# would hide the thing this directory exists to show. linguist-vendored drops it",
      "# from the language bar and leaves the diff expanded.",
      `${dir}/** linguist-vendored=true`,
    ],
    config: { [C_ENABLED]: true, [C_DIR]: dir },
  };
}

/**
 * The inverse of {@link contributes}: the stored config block, read back as the
 * answers that produced it.
 *
 * REQUIRED HERE, not optional, because the two vocabularies differ — the
 * question is `xanoscript`, the config key is `enabled`. The SDK will not guess
 * that mapping, and without this hook a re-ask offers the SHIPPED DEFAULTS and,
 * in a non-interactive run, ANSWERS with them: a project that chose
 * `backend/xs` would silently move back to `xanoscript/`, and one that declined
 * the tree entirely would have it switched back on.
 *
 * A value of the wrong type is DROPPED rather than handed back. The block is
 * user-editable JSON, so `dir: 7` is reachable; it is not an answer the
 * questionnaire can carry, and `resolveOptions` is the one place that refuses
 * it by name. Omitting a key means "not answered", which lets the SDK fall
 * through to that question's default — the honest outcome for a block that
 * never recorded one.
 *
 * WHAT IT CANNOT RECOVER: a `dir` the project chose does not survive being
 * DECLINED and later re-enabled. Declining makes `contributes` return `{}`,
 * the SDK records that as `{ enabled: false }` and REPLACES the stored block,
 * and `dir` — which `when` excluded from that run's answers — goes with it. So
 * re-enabling writes the tree to `xanoscript/` and leaves the old `backend/xs`
 * tree committed but orphaned, since `onBundle` prunes only inside the
 * directory it is configured with.
 *
 * That is the contract working as written, not a gap this hook can close: the
 * SDK deletes an excluded question's stale key deliberately, and recording a
 * directory for a module nobody enabled is the thing `when` exists to prevent.
 * This hook is the inverse of ONE round trip, which is the case that decides
 * whether a re-ask silently resets a live choice. Across a decline there is no
 * stored answer left to invert.
 */
function answersFromConfig(config: Readonly<Record<string, unknown>>): PluginAnswers {
  const answers: Record<string, string | boolean> = {};
  if (typeof config[C_ENABLED] === "boolean") answers[Q_ENABLED] = config[C_ENABLED];
  if (typeof config[C_DIR] === "string") answers[Q_DIR] = config[C_DIR];
  return answers;
}

// ─────────────────────────────────────────────────────────────────────────────
// onBundle: write or verify the committed tree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Why a `--bundle <path>` run writes NOTHING.
 *
 * The contract makes `entry` optional rather than inventing a path, and this is
 * the branch it was made optional for. A tree is a claim about the SOURCE
 * BESIDE IT — its README says so, review reads it that way, and the
 * `--frozen-lock` check exists to keep the two in step. A bundle handed in as
 * already-serialized text has no entry and no registry behind it: it may have
 * been compiled from a different commit, a different repo, or an engine export.
 * Rendering it into this project's `xanoscript/` would overwrite a correct tree
 * with one describing something else, and the prune would delete the documents
 * of every object that bundle happens not to contain.
 *
 * Skipping is reported, never silent. A run that quietly did nothing would be
 * read as a run that confirmed something.
 */
const NO_ENTRY_MESSAGE =
  "xanoscript — skipped: this bundle was supplied with `--bundle`, so there is no entry it was compiled from. " +
  "The committed tree describes the source beside it; regenerate it by exporting the workspace entry.";

async function onBundle(ctx: BundleContext): Promise<HookResult> {
  // Order is the contract: validate, then check the peer, then decide whether
  // to act. Both refusals must reach a disabled project too — a bad `dir` or a
  // wrong SDK is a configuration error worth hearing about whether or not this
  // particular run would have written anything.
  const opts = resolveOptions(ctx.config, ctx.cwd);
  assertSdkVersion(ctx.sdkVersion);
  if (!opts.enabled) return {};
  if (ctx.entry === undefined) return { message: NO_ENTRY_MESSAGE };

  const multidoc = emitBundleXanoScript(ctx.bundle, { guid: true });
  const warnings: string[] = [];
  const placeholders = placeholderWarning(multidoc);
  if (placeholders !== null) warnings.push(placeholders);

  const provenance = treeProvenance(ctx);

  if (ctx.frozen) {
    // COMPARE ONLY. Nothing below this line may touch the filesystem: the
    // whole value of `--frozen-lock` is that a CI run reports a stale tree
    // instead of quietly bringing it up to date and passing.
    const { changed, removed } = checkXanoScriptTree(opts.absDir, multidoc, provenance);
    if (changed.length === 0 && removed.length === 0) {
      return { message: `xanoscript ✓ ${opts.dir}/ matches the source`, ...(warnings.length > 0 ? { warnings } : {}) };
    }
    return {
      failed: true,
      message: `xanoscript ✗ ${opts.dir}/ is stale — ${changed.length} file(s) differ, ${removed.length} left over. Regenerate it and commit the result.`,
      warnings: [
        ...changed.slice(0, 20).map((f) => `differs: ${f}`),
        ...removed.slice(0, 20).map((f) => `no longer produced: ${f}`),
        ...(changed.length + removed.length > 40 ? [`… ${changed.length + removed.length - 40} more`] : []),
        ...warnings,
      ],
    };
  }

  const { written, removed } = writeXanoScriptTree(opts.absDir, multidoc, provenance);
  return {
    message: `xanoscript → ${opts.dir}/ (${written.length} document(s)${removed.length > 0 ? `, ${removed.length} removed` : ""})`,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function treeProvenance(ctx: BundleContext): TreeProvenance {
  const entry = ctx.entry!;
  const rel = relative(ctx.cwd, entry);
  return {
    // A path outside the project (an absolute entry elsewhere) stays absolute
    // rather than becoming a `../../` the README's reader cannot follow.
    source: rel === "" || rel.startsWith("..") ? entry : rel,
    ...projectTreeScripts(ctx.cwd),
    version: ctx.sdkVersion,
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// onPreflight: the emitter against the engine's own rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The comparison. The SDK fetched the engine's multidoc and handed over both
 * payloads; every derivation from here is this module's, including the
 * exclusion below.
 *
 * Two renderings, and only one of them can fail the run:
 *
 * - `fromExported` starts from the ENGINE'S OWN export, so both sides share one
 *   JSON and any difference is the emitter's. The emitter's contract is byte
 *   equality with the engine, so this one fails.
 * - `fromBundle` starts from the compiled bundle with its guids translated to
 *   the engine's re-minted ones. Its extra differences are the JSON the engine
 *   fills in on import, which preflight's own per-object round-trip already
 *   reports. Informational.
 */
async function onPreflight(ctx: PreflightContext): Promise<HookResult> {
  const opts = resolveOptions(ctx.config, ctx.cwd);
  assertSdkVersion(ctx.sdkVersion);
  if (!opts.enabled) return {};

  // UNAVAILABLE IS NOT DRIFT. Treating a failed fetch as an empty rendering
  // would diff every document in the workspace against nothing and report a
  // total mismatch that is really a network error — and would fail CI for it.
  if (ctx.engineRendering.kind === "error") {
    return {
      message: "xanoscript ? the engine's rendering could not be fetched, so the emitter was not compared",
      warnings: [ctx.engineRendering.why],
    };
  }
  const engine = ctx.engineRendering.text;

  const features = { guid: true };
  const fromExported = emitWorkspaceMultidoc({ payload: ctx.exportedPayload as never }, { features });
  const fromBundle = emitWorkspaceMultidoc({ payload: ctx.remappedPayload as never }, { features });

  const port = diffMultidocs(engine, fromExported);
  // The engine's JSON export carries only the api groups its exported queries
  // reference; its XanoScript export renders every group. So a group with no
  // queries is absent from `fromExported` BY CONSTRUCTION, and reporting it as
  // drift would fail a workspace that is entirely correct. Matched by document
  // identity, not by name text, so quoting differences do not slip past.
  const exportedGroups = new Set(records(ctx.exportedPayload.app).map((a) => String(a.name ?? "")));
  const queryLessApiGroups = records(ctx.remappedPayload.app)
    .map((a) => String(a.name ?? ""))
    .filter((name) => name !== "" && !exportedGroups.has(name));
  const skipped = new Set(
    [...diffsFor(port, new Set(queryLessApiGroups.map(apiGroupIdentity)), engine)].filter((d) => d.status === "missing-local"),
  );
  port.diffs = port.diffs.filter((d) => !skipped.has(d));
  const compared = port.docs - skipped.size;

  const warnings: string[] = [];
  if (skipped.size > 0) {
    warnings.push(`${skipped.size} api group(s) without queries are absent from the engine's JSON export and were not compared`);
  }

  const failed = port.diffs.length > 0;
  const message = failed
    ? `xanoscript ✗ emitter differs from the engine in ${port.diffs.length} of ${compared} document(s)`
    : `xanoscript ✓ emitter matches the engine (${compared} document(s), byte-identical)`;

  if (failed) {
    const shown = ctx.verbose ? port.diffs : port.diffs.slice(0, 10);
    for (const d of shown) warnings.push(describeDiff(d, ctx.verbose));
    if (!ctx.verbose && port.diffs.length > shown.length) warnings.push(`… ${port.diffs.length - shown.length} more (run with --verbose)`);
  }

  // The informational half. A document whose ONLY difference is its `guid` line
  // is one the round-trip could not pair (a query-less group, two queries
  // sharing a name), so its compiled guid was never translated — that says
  // nothing about what the engine normalizes.
  const authored = diffMultidocs(engine, fromBundle);
  const authoredDiffs = authored.diffs.filter((d) => d.status !== "changed" || d.lines.some(([, e, l]) => !isGuidLine(e) || !isGuidLine(l)));
  if (authoredDiffs.length > 0) {
    warnings.push(
      `this bundle's own rendering differs from the engine in ${authoredDiffs.length} document(s) — the JSON the engine fills in on import, not the emitter`,
    );
    if (ctx.verbose) for (const d of authoredDiffs) warnings.push(`  ${describeDiff(d, false)}`);
  }

  return { message, ...(failed ? { failed: true } : {}), ...(warnings.length > 0 ? { warnings } : {}) };
}

function describeDiff(d: DocDiff, verbose: boolean): string {
  if (d.status !== "changed") return `${d.header}  ${d.status === "missing-local" ? "not rendered locally" : "not rendered by the engine"}`;
  const head = `${d.header}  line ${d.line}: engine ${fmt(d.engine)}, local ${fmt(d.local)}`;
  if (!verbose) return head;
  return [head, ...d.lines.slice(1).map(([n, e, l]) => `    line ${n}: engine ${fmt(e)}, local ${fmt(l)}`)].join("\n");
}

function isGuidLine(line: string | undefined): boolean {
  return line !== undefined && /^\s*guid = "/.test(line);
}

function fmt(v: string | undefined): string {
  return v === undefined ? "(absent)" : JSON.stringify(v);
}

function records(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v.filter((r) => typeof r === "object" && r !== null) as Array<Record<string, unknown>>) : [];
}

/**
 * The default export the SDK's loader reads. `kind` is repeated from the
 * manifest so the two must agree — a mismatch means one of them is stale, and
 * guessing which would run code the manifest did not describe.
 */
const plugin: ToolchainPlugin = {
  kind: "toolchain",
  questions,
  contributes,
  answersFromConfig,
  onBundle,
  onPreflight,
};

export default plugin;
