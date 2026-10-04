/**
 * Rendering ONE def on its own — `table()`, `query()` or a function — rather
 * than a whole workspace, and the lock-derived name maps that let a lone def
 * still name the objects it references.
 *
 * This is the only file on the emitter side that imports `@xano/sdk`: it has
 * to run the SDK's own encoders (`compile`, `encodeTable`, `encodeQuery`) to
 * get the stored row the emitter renders. Everything else in `src/` is
 * peer-free by design — see AGENTS.md.
 */
import { compile } from "@xano/sdk";
import type { FunctionDef, QueryDef, TableDef } from "@xano/sdk";
import { encodeQuery, encodeTable, resolveRef, LOCK_PAYLOAD_KEYS, type LockFile } from "@xano/sdk/internal";
import { createScriptContext, emitXanoScript, type ScriptMaps } from "./index.js";

/**
 * Which emitter map a lock payload key feeds. Every key the lock can carry
 * (`LOCK_PAYLOAD_KEYS`, derived from the identity table) must appear here or
 * be listed as one the emitter has no map for, so a kind added to the identity
 * table cannot silently stop resolving when a single def is rendered.
 */
const LOCK_MAP_KEYS: Readonly<Record<string, keyof ScriptMaps | null>> = {
  dbo: "dbo",
  function: "function",
  addon: "addon",
  task: "task",
  middleware: "middleware",
  app: "app",
  toolset: "toolset",
  tool: "tool",
  trigger: "trigger",
  workflow_test: "workflowTest",
  realtime_server: "realtimeServer",
  // The lock names a v2 channel by its bare path; the emitter's map is keyed
  // `<server>|<path>`, and the lock does not carry the server half.
  channel: null,
  // Keyed `name|verb|app.id` in the emitter; the lock names the group, not its id.
  query: null,
  // Keyed `name|channel.id` in the emitter; the lock cannot supply the id half.
  message: null,
  // Referenced by nothing a script renders.
  knowledge: null,
  knowledge_file: null,
  microservice: null,
  // MCP server prompts and resources: the emitter has no map for either.
  prompt: null,
  resource: null,
};

/** The lock payload keys this table does not account for (empty by construction; see the test). */
export function unmappedLockPayloadKeys(): string[] {
  return [...LOCK_PAYLOAD_KEYS].filter((key) => !(key in LOCK_MAP_KEYS));
}

/**
 * Name → guid maps from a lock file, so a single def rendered on its own can
 * still name the objects it references (`db.query users`, `api_group = "public"`).
 * The lock records exactly the identities the bundle bakes, so this resolves the
 * same names the workspace render does; without one, unresolved references are
 * omitted the way the engine omits them for an object outside the export scope.
 */
export function mapsFromLock(lock: LockFile | undefined): ScriptMaps {
  const maps: ScriptMaps = {};
  if (!lock) return maps;
  for (const [key, entry] of Object.entries(lock.objects)) {
    if (entry.guid === undefined) continue;
    const colon = key.indexOf(":");
    if (colon < 0) continue;
    const mapKey = LOCK_MAP_KEYS[key.slice(0, colon)];
    if (mapKey === undefined || mapKey === null) continue;
    const name = key.slice(colon + 1);
    (maps[mapKey] ??= {})[name] = entry.guid;
  }
  return maps;
}

/**
 * Render one def as XanoScript, dispatching on its kind exactly as `emit()`
 * does for JSON: a `table()` → `table`, a `query()` → `query`, anything else →
 * `function`. A query's api group and auth table are named from the def itself
 * (their guids derive from their names), so those resolve even without a lock.
 */
export function emitDefXanoScript(def: FunctionDef | QueryDef | TableDef, lock?: LockFile): string {
  return renderDef(def, lock).text;
}

/** A reference the render could not name: which kind of object, and the id it looked for. */
export interface UnresolvedReference {
  label: string;
  id: unknown;
}

/**
 * `emitDefXanoScript` plus the references the render left blank — the engine
 * renders an object it cannot name as `""` rather than failing, and for a lone
 * def that almost always means the lock did not cover it.
 */
export function renderDef(def: FunctionDef | QueryDef | TableDef, lock?: LockFile): { text: string; unresolved: UnresolvedReference[] } {
  const maps = mapsFromLock(lock);
  let kind = "schema:function";
  let row: unknown;
  if ("schema" in def && def.schema !== undefined) {
    kind = "schema:table";
    row = encodeTable(def);
  } else if ("verb" in def && def.verb !== undefined) {
    kind = "schema:query";
    const group = def.apiGroup;
    if (group !== undefined) {
      const name = typeof group === "string" ? group : group.name;
      (maps.app ??= {})[name] = resolveRef("app", group);
    }
    const auth = def.auth;
    if (auth !== undefined && auth !== null && auth !== false && typeof auth !== "number") {
      const name = typeof auth === "string" ? auth : auth.name;
      (maps.dbo ??= {})[name] = resolveRef("dbo", auth);
    }
    row = encodeQuery(def);
  } else {
    // Neither a table nor a query, so a function; the `in` checks above do not narrow the union.
    row = compile(def as FunctionDef);
  }
  const context = createScriptContext(maps);
  const text = emitXanoScript(kind, row, { context });
  return { text, unresolved: context.takeUnresolved() };
}
