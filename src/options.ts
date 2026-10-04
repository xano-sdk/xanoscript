/**
 * The module's per-project options, and the single gate every one of them
 * passes through.
 *
 * EVERY validation lives here, and it runs BEFORE any work in either hook.
 * The reason is `dir`: `onBundle` PRUNES the directory it is handed — every
 * `.xs` under the layout's roots that this run does not produce is removed —
 * so the option naming that directory is the one place where a typo in a
 * `package.json` turns into deleted files. Validating at the point of use
 * would mean validating it after the renderer has already decided where to
 * write.
 *
 * The values arrive as `ctx.config`: the block `files()` wrote into the
 * project's `package.json` at `init`, read back verbatim on every later run.
 * It is JSON a human can edit, so nothing here may assume a type.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DEFAULT_TREE_DIR } from "./writer.js";

/** The package name every message names, so a project with several modules can tell whose complaint this is. */
export const PACKAGE_NAME = "@xano-sdk/xanoscript";

/** Directory names the tree may never live under, each with the reason it is refused. */
const FORBIDDEN_ROOTS: Readonly<Record<string, string>> = {
  // A build directory is wiped by the build, so a committed review surface
  // written into it is deleted by the next `npm run build` and silently
  // regenerated — a tree that exists only between two commands.
  dist: "a build directory the toolchain deletes and regenerates",
  // The SDK's own scratch directory. A generated tree there is neither
  // committed nor reviewable, which is the entire point of writing one.
  ".xano": "the SDK's own scratch directory, which is not committed",
};

/** The module's options, after validation and with the defaults filled in. */
export interface XanoScriptOptions {
  /**
   * Whether the module does anything at all. Absent means ON: a project that
   * installed a toolchain module and wrote no config asked for its behavior.
   * `false` is a complete no-op on every hook, not a quieter one.
   */
  enabled: boolean;
  /** The tree directory, exactly as configured — relative, for messages. */
  dir: string;
  /** The same directory resolved against the project root; what the writer is handed. */
  absDir: string;
}

/** Raised for a configuration the module refuses to act on. Named so a caller can tell it from a render failure. */
export class OptionsError extends Error {
  override readonly name = "OptionsError";
}

function fail(message: string): never {
  throw new OptionsError(`${PACKAGE_NAME}: ${message}`);
}

/**
 * Validate and resolve this module's block from the project's `package.json`.
 *
 * `cwd` is the project root, and it is not decoration: `dir` is RESOLVED
 * against it and rejected if the result lands outside. A denylist of names
 * cannot do that job — `../../..` is not absolute, is not `dist`, and is not
 * `.xano`, and it names a directory the prune would happily walk. Only
 * resolution answers the question that matters, which is where the path ENDS
 * UP, not what it is spelled like.
 */
export function resolveOptions(config: Readonly<Record<string, unknown>> | undefined, cwd: string): XanoScriptOptions {
  const raw = config ?? {};

  const enabledRaw = raw.enabled;
  if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
    fail(`the "enabled" option must be true or false (got ${describe(enabledRaw)}).`);
  }
  const enabled = enabledRaw ?? true;

  const dirRaw = raw.dir;
  if (dirRaw !== undefined && typeof dirRaw !== "string") {
    fail(`the "dir" option must be a string naming a directory (got ${describe(dirRaw)}).`);
  }
  const dir = dirRaw === undefined || dirRaw === "" ? DEFAULT_TREE_DIR : dirRaw;

  if (isAbsolute(dir)) {
    fail(`the "dir" option must be relative to the project, not an absolute path (got ${JSON.stringify(dir)}).`);
  }

  const absDir = resolve(cwd, dir);
  const rel = relative(cwd, absDir);
  // `relative` answers with a `..` prefix exactly when the target is outside
  // the base, and with "" when it IS the base — which would hand the prune the
  // whole project.
  if (rel === "") {
    fail(`the "dir" option must name a directory inside the project, not the project root itself (got ${JSON.stringify(dir)}).`);
  }
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail(
      `the "dir" option resolves outside the project root (${JSON.stringify(dir)} → ${absDir}). ` +
        "The tree directory is pruned on every write, so it must stay inside the project.",
    );
  }

  const first = rel.split(sep)[0] ?? "";
  const why = FORBIDDEN_ROOTS[first];
  if (why !== undefined) {
    fail(`the "dir" option must not be inside ${JSON.stringify(first)} — ${why} (got ${JSON.stringify(dir)}).`);
  }

  return { enabled, dir, absDir };
}

/** A value named for a message, without ever printing a user's whole config object. */
function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v;
}
