/**
 * The committed `xanoscript/` tree: how a rendered multidoc lands on disk, the
 * note the tree carries for the humans and agents who open it, and the scan
 * that reports statements the engine has no XanoScript form for.
 *
 * Node-only — this is the half that touches the filesystem. It imports NOTHING
 * from `@xano/sdk`: everything here works from a multidoc string and a
 * bundle payload, which is what keeps the `.` entry peer-free.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { emitWorkspaceMultidoc, type MultidocSections } from "./multidoc.js";
import { layoutRoots, placeMultidoc } from "./tree.js";

/**
 * Render a `packageExport` bundle (serialized or not) as the workspace's
 * XanoScript multidoc. The `guid` feature is ON by default, as it is on the
 * engine's own multidoc routes, so every document carries its identity. For a
 * compiled bundle those are the guids `xano.lock` pins (stable across exports);
 * the engine mints its own on import, so they match an engine rendering only
 * for a bundle the engine exported (`xanosdk ephemeral export --format multidoc`).
 */
export function emitBundleXanoScript(
  bundle: string | { payload?: Record<string, unknown> },
  options: { guid?: boolean } = {},
): string {
  const parsed = typeof bundle === "string" ? (JSON.parse(bundle) as { payload?: Record<string, unknown> }) : bundle;
  return emitWorkspaceMultidoc({ payload: (parsed.payload ?? {}) as MultidocSections }, { features: { guid: options.guid ?? true } });
}

/**
 * Write a multidoc as one file per object under `dir` — the layout
 * `xano workspace pull` produces (see `placeMultidoc`), so the tree can be
 * read, diffed and pushed like a pulled workspace.
 *
 * The tree is generated output and owned outright, like a compiler's out
 * directory: every `.xs` under the layout's directories is removed first, so a
 * renamed or deleted object never leaves its old document behind to be pushed
 * as a second object. No state file is kept; the rule is the same every run.
 */
/** What a tree's README needs to know about where the tree came from and how the repo maintains it. */
export interface TreeProvenance {
  /** The workspace entry file the documents were rendered from. */
  source: string;
  /** The command that regenerates the tree, as a reader should run it (`npm run xano:export`). */
  regenerate: string;
  /** The command that fails when the committed tree is stale, when the repo has one. */
  check?: string;
  /** The SDK version that rendered it. */
  version?: string;
}

/**
 * The note every generated tree carries. It is written for the three readers
 * who open the folder: a reviewer deciding whether to read the XanoScript or
 * the TypeScript, a newcomer wondering whether the files are editable, and a
 * coding agent that will do exactly what the first paragraph says. It names the
 * repo's own commands rather than generic ones, and carries nothing that
 * changes from run to run (no timestamp), so regenerating an unchanged
 * workspace leaves it untouched.
 */
export function treeReadme(p: TreeProvenance): string {
  const from = `rendered from the TypeScript workspace \`${p.source}\` by \`xanosdk export\``;
  const edit = `Edit the TypeScript under \`${dirname(p.source) === "." ? "." : dirname(p.source)}/\` and regenerate with \`${p.regenerate}\`; anything changed here is overwritten by the next run.`;
  const honest =
    p.check !== undefined
      ? `\`${p.check}\` fails when the committed copy is stale, so a change cannot ship with a tree that disagrees with its source.`
      : "Regenerate it in the same change as the source, so the two never disagree.";
  const lines = [
    "# XanoScript rendering (generated)",
    "",
    `**Do not edit these files.** They are ${from}, and the whole directory is replaced on every run.`,
    edit,
    "",
    "## Why it is committed",
    "",
    "A change to the backend shows up in review as the XanoScript it produces, one file per",
    "object, beside the code that produced it. Read the diff here to see what the engine will",
    "run; ask for changes in the source.",
    "",
    honest,
    "",
    "## After a merge, regenerate",
    "",
    "A clean merge is not evidence this tree is correct. Two branches that change different",
    "objects merge without a conflict, yet one side's files were rendered before the other's",
    "source change existed, so the merged tree can name an object that was renamed away.",
    "Nothing in git can see that: at the text level the two sides never touched the same file.",
    "",
    `Regenerate after every merge${p.check !== undefined ? `, and let \`${p.check}\` confirm it` : ""}.`,
    "Never hand-edit a file here and never hand-resolve a conflict in one: the correct content",
    "is whatever the source renders to, so the only valid resolution is to re-derive it.",
    "",
    "## Reading the tree",
    "",
    "| Path | What it is |",
    "|---|---|",
    `| \`workspace/<name>.xs\` | the workspace settings; \`workspace/trigger/\` its triggers |`,
    `| \`table/<name>.xs\` | a table; \`table/trigger/\` its triggers |`,
    `| \`api/<group>/<group>.xs\` | an API group; \`api/<group>/<path>/<name>_<VERB>.xs\` each of its endpoints |`,
    `| \`function/\`, \`task/\`, \`addon/\`, \`middleware/\` | one file per object |`,
    `| \`ai/agent/\`, \`ai/mcp_server/\`, \`ai/tool/\` | agents, MCP servers and tools; a \`trigger/\` folder beneath each |`,
    `| \`realtime/server/<server>/channel/<channel>/message/\` | realtime servers, their channels, their messages, with triggers beneath each |`,
    `| \`workflow_test/\`, \`microservice/\` | one file per object |`,
    "",
    `Names are snake_cased (\`get-user\` becomes \`get_user.xs\`); a path parameter such as \`{id}\` becomes a`,
    `directory segment. This is the layout the Xano CLI writes on \`pull\`, so the tree can be`,
    `pushed to an environment as it is (\`xano ephemeral push <env> --directory ${DEFAULT_TREE_DIR}\`) and`,
    "pulls back byte for byte.",
    "",
    `A \`guid = "..."\` line is the object's identity, pinned by the workspace's \`xano.lock\`; it is what`,
    `keeps a rename a rename on the engine. A \`placeholder "<name>"\` line marks a statement the`,
    "engine's XanoScript cannot express; the export warns about each one.",
    "",
  ];
  if (p.version !== undefined) lines.push(`Generated with @xano/sdk ${p.version}.`, "");
  return lines.join("\n");
}

/** The tree directory a project commits, and the name the README points at. */
export const DEFAULT_TREE_DIR = "xanoscript";

/** The command a reader runs when the project has no export script of its own. */
const RAW_REGENERATE = "xanosdk export <entry>";

/**
 * Which of a project's npm scripts run `xanosdk export` (the command that
 * writes the tree once this module is installed), and which one checks it (the
 * same export under `--check` or `--frozen-lock`, which fails on a stale tree
 * instead of rewriting it), so the README can name the commands a reader of
 * THIS repo should run. Best effort: a missing or unreadable package.json
 * yields the raw command.
 */
export function projectTreeScripts(cwd: string): { regenerate: string; check?: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const scripts = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) => /xanosdk export\b/.test(cmd));
    const check = scripts.find(([, cmd]) => /--frozen-lock\b|--check\b/.test(cmd))?.[0];
    const regenerate = scripts.find(([name]) => name !== check)?.[0] ?? scripts[0]?.[0];
    return {
      regenerate: regenerate !== undefined ? `npm run ${regenerate}` : RAW_REGENERATE,
      ...(check !== undefined ? { check: `npm run ${check}` } : {}),
    };
  } catch {
    return { regenerate: RAW_REGENERATE };
  }
}

/** What one run of the writer would do to `dir`, worked out without touching it. */
interface TreePlan {
  placed: ReturnType<typeof placeMultidoc>;
  /** Documents whose file is missing or holds different text. */
  changed: string[];
  /** `.xs` files under the layout's directories that no document produces. */
  stale: string[];
  readme: string;
  readmeChanged: boolean;
}

function planTree(dir: string, multidoc: string, provenance: TreeProvenance): TreePlan {
  if (existsSync(dir) && !statSync(dir).isDirectory()) {
    throw new Error(`${dir} is a file; the XanoScript tree is a directory of .xs files. Name a directory.`);
  }
  const placed = placeMultidoc(multidoc);
  const keep = new Set(placed.map((doc) => doc.relPath));

  // Every `.xs` under a directory the layout can write into that this run does
  // not produce is stale; the roots come from the placement rules, so a
  // document that moved between runs is caught wherever it used to live.
  const stale: string[] = [];
  for (const root of layoutRoots()) {
    const abs = join(dir, root);
    if (existsSync(abs)) collectStale(abs, dir, keep, stale);
  }
  const changed = placed.filter((doc) => !fileHolds(join(dir, ...doc.relPath.split("/")), doc.content)).map((doc) => doc.relPath);
  const readme = treeReadme(provenance);
  return { placed, changed, stale, readme, readmeChanged: !fileHolds(join(dir, "README.md"), readme) };
}

function fileHolds(abs: string, content: string): boolean {
  return existsSync(abs) && readFileSync(abs, "utf8") === content;
}

/**
 * What `writeXanoScriptTree` would change, without changing it: the files it
 * would write (missing or different, the README included) and the stale ones
 * it would remove. Both empty means the committed tree is what the source
 * renders to, which is the `export --check` / `--frozen-lock` check: a CI run must
 * report a stale tree, never quietly bring it up to date.
 */
export function checkXanoScriptTree(dir: string, multidoc: string, provenance: TreeProvenance): { changed: string[]; removed: string[] } {
  const plan = planTree(dir, multidoc, provenance);
  return { changed: [...plan.changed, ...(plan.readmeChanged ? ["README.md"] : [])], removed: plan.stale };
}

export function writeXanoScriptTree(dir: string, multidoc: string, provenance: TreeProvenance): { written: string[]; removed: string[] } {
  const plan = planTree(dir, multidoc, provenance);
  for (const rel of plan.stale) rmSync(join(dir, ...rel.split("/")));
  for (const root of layoutRoots()) {
    const abs = join(dir, root);
    if (existsSync(abs)) removeEmptyDirs(abs);
  }

  // Unchanged files are left alone so a committed tree does not churn mtimes.
  // Each file holds the document text exactly as `xano workspace pull` writes
  // it — no trailing newline — so a pulled tree and this one diff clean.
  mkdirSync(dir, { recursive: true });
  const changed = new Set(plan.changed);
  for (const doc of plan.placed) {
    if (!changed.has(doc.relPath)) continue;
    const abs = join(dir, ...doc.relPath.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, doc.content, "utf8");
  }
  if (plan.readmeChanged) writeFileSync(join(dir, "README.md"), plan.readme, "utf8");
  return { written: plan.placed.map((doc) => doc.relPath), removed: plan.stale };
}

/** Collect every `.xs` under `abs` that is not in `keep`, as paths relative to `root`. */
function collectStale(abs: string, root: string, keep: ReadonlySet<string>, out: string[]): void {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = join(abs, entry.name);
    if (entry.isDirectory()) {
      collectStale(child, root, keep, out);
    } else if (entry.name.endsWith(".xs")) {
      const rel = relative(root, child).split(sep).join("/");
      if (!keep.has(rel)) out.push(rel);
    }
  }
}

/** Remove the directories under `abs`, and `abs` itself, that the prune left empty. */
function removeEmptyDirs(abs: string): void {
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(join(abs, entry.name));
  }
  if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true });
}

/** Where a stored statement name with no XanoScript form comes from, for the placeholder warning. */
const AUTHORED_AS: Readonly<Record<string, string>> = {
  // `s.db.get_by_id` now emits the field match (`db.get` on `id`), so a bundle
  // carrying this was built by an older SDK, or pulled from a workspace edited
  // elsewhere.
  "mvp:dbo_get": "s.db.get_by_id as an older @xano/sdk emitted it — re-export with the current SDK",
  // `s.security.create_guid` no longer exists; `s.security.create_uuid` renders.
  "mvp:guid": "s.security.create_guid, which @xano/sdk no longer has — use s.security.create_uuid",
};

/**
 * Statements a rendering could only show as `placeholder "<name>"`: the engine
 * has no XanoScript form for them, so its own pull renders the same line and
 * a push of that line does not recreate the statement. Counted by stored
 * name so the warning can say what to author instead.
 */
export function placeholderStatements(xanoscript: string): Array<{ name: string; count: number; authoredAs?: string }> {
  const counts = new Map<string, number>();
  for (const m of xanoscript.matchAll(/^\s*placeholder "([^"]*)"\s*$/gm)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count, ...(AUTHORED_AS[name] ? { authoredAs: AUTHORED_AS[name] } : {}) }));
}

/** The one-line warning for `placeholderStatements`, or null when there is nothing to say. */
export function placeholderWarning(xanoscript: string): string | null {
  const found = placeholderStatements(xanoscript);
  if (found.length === 0) return null;
  const list = found.map((f) => `${f.name} ×${f.count}${f.authoredAs ? ` (${f.authoredAs})` : ""}`).join(", ");
  return (
    `${found.reduce((n, f) => n + f.count, 0)} statement(s) have no XanoScript form and rendered as \`placeholder\`: ${list}. ` +
    "The engine's own pull renders them the same way, and pushing the placeholder does not recreate the statement."
  );
}
