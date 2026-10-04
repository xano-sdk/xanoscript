/**
 * Port of redacted: render a whole
 * workspace bundle as one XanoScript multidoc (documents joined by `\n---\n`),
 * in the engine's order, registering each name map exactly when the engine
 * does so cross-references resolve (or fail to) the same way.
 *
 * The input is a `packageExport` payload — what `xanosdk export` writes and
 * what the engine's own workspace export returns — so this renders both an
 * SDK-authored bundle (references by guid) and a pulled workspace
 * (references by numeric id).
 */
import { withScriptContext } from "./engine/context.js";
import { ScriptContext, type Feature, type ScriptMaps } from "./engine/script-context.js";
import { withRenderState } from "./engine/state.js";
import { StdClass, isPhpArray, phpEmpty } from "./engine/php.js";
import { processConvert } from "./transform/process.js";

type Row = Record<string, unknown>;

export interface MultidocSections {
  workspace?: Row;
  dbo?: Row[];
  function?: Row[];
  middleware?: Row[];
  app?: Row[];
  query?: Row[];
  task?: Row[];
  addon?: Row[];
  toolset?: Row[];
  tool?: Row[];
  trigger?: Row[];
  workflow_test?: Row[];
  realtime_server?: Row[];
  channel?: Row[];
  message?: Row[];
  microservice?: Row[];
  [key: string]: unknown;
}

export interface MultidocOptions {
  /** Which document groups to emit; everything defaults to on. */
  include?: Partial<Record<"table" | "function" | "query" | "task" | "addon" | "middleware" | "ai" | "action" | "workflow_test" | "trigger" | "realtime" | "realtime_v2" | "microservice", boolean>>;
  /** Engine export features: `guid` lines, workspace `env`, table `items` (records). */
  features?: Partial<Record<Feature, boolean>>;
  /** Extra name → id entries laid over the maps derived from the payload (a reference to an object outside it). */
  maps?: ScriptMaps;
  /** Reuse a prepared context. */
  context?: ScriptContext;
}

/** A payload row's identity: its numeric id when it has one, its guid otherwise (both when present). */
function rowId(row: Row): unknown {
  const id = row.id;
  const guid = row.guid;
  if (id !== undefined && id !== null && guid !== undefined && guid !== null && guid !== "") return [id, guid];
  if (id !== undefined && id !== null) return id;
  return guid ?? 0;
}

function byName(rows: Row[] | undefined): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const row of rows ?? []) {
    if (phpEmpty(row.name)) continue;
    map[String(row.name)] = rowId(row);
  }
  return map;
}

function ensureNamed(rows: Row[] | undefined, objectType: string): void {
  for (const row of rows ?? []) {
    if (!phpEmpty(row.name)) continue;
    throw new Error(`${objectType[0]!.toUpperCase()}${objectType.slice(1)} ID #${String(row.id ?? "unknown")} is missing a name and unable to be exported`);
  }
}

function refId(row: Row, key: string): unknown {
  const ref = row[key];
  if (isPhpArray(ref) && !Array.isArray(ref)) return (ref as Row).id ?? 0;
  return ref ?? 0;
}

/** Render one group of rows through the engine's per-object convert, appending each document. */
function processItems(kind: string, rows: Row[] | undefined, docs: string[]): void {
  for (const row of rows ?? []) {
    docs.push(processConvert(kind, row).output);
  }
}

/** The payload as the engine's export sees it — rows may be lists or keyed maps. */
function rows(section: unknown): Row[] {
  if (Array.isArray(section)) return section as Row[];
  if (isPhpArray(section)) return Object.values(section as object) as Row[];
  return [];
}

/**
 * Code-point order, which is the byte order of the UTF-8 encoding — what
 * `ORDER BY name` yields on the engine's database (Postgres on Alpine, whose
 * `en_US.utf8` collation is musl's `strcmp`). Plain string comparison orders
 * by UTF-16 code unit instead, which disagrees beyond the Basic Multilingual
 * Plane; `localeCompare` disagrees on almost everything.
 */
function codePointCompare(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * The engine renders most kinds in table order (the order they were created,
 * which is the order a bundle imports them), but its loaders for queries,
 * realtime servers, channels and messages sort by name. Stable, so rows that
 * share a name (a GET and a POST query) keep their payload order.
 */
function sortedByName(list: Row[]): Row[] {
  return list
    .map((row) => ({ row, key: String(row.name ?? "") }))
    .sort((a, b) => codePointCompare(a.key, b.key))
    .map((x) => x.row);
}

/** `action` map: run name → its run version id. */
function actionMap(items: Row[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const item of items) {
    if (phpEmpty(item.name)) continue;
    map[String(item.name)] = refId(item, "run_version");
  }
  return map;
}

/** `actionPackage` map: `package name|action name` → `trace id|version id|package slug`. */
function actionPackageMap(items: Row[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const item of items) {
    if (phpEmpty(item.name)) continue;
    const version = (item.version ?? {}) as Row;
    const pkg = (item.package ?? {}) as Row;
    for (const action of rows(version.actions)) {
      map[[item.name, action.name].join("|")] = [action.trace_id ?? "NA", version.id ?? "NA", pkg.slug ?? "NA"].join("|");
    }
  }
  return map;
}

export function emitWorkspaceMultidoc(input: MultidocSections | { payload: MultidocSections }, options: MultidocOptions = {}): string {
  const payload = ("payload" in input && input.payload && typeof input.payload === "object" && !("workspace" in input) ? input.payload : input) as MultidocSections;
  const include = { table: true, function: true, query: true, task: true, addon: true, middleware: true, ai: true, action: true, workflow_test: true, trigger: true, realtime: true, realtime_v2: true, microservice: true, ...(options.include ?? {}) };
  const ctx = options.context ?? new ScriptContext();
  ctx.setFeatures({ guid: false, workspaceEnv: false, tableItems: false, ...(options.features ?? {}) });
  if (options.maps) ctx.registerMaps(options.maps);
  // Every registration lays the caller's entries over the derived map, so an
  // override survives the re-registrations the engine's export order performs.
  const register = (name: keyof ScriptMaps, map: Record<string, unknown>): void => {
    ctx.registerMap(name, { ...map, ...(options.maps?.[name] ?? {}) });
  };

  const workspace = (payload.workspace ?? {}) as Row;
  const dbos = rows(payload.dbo);
  const functions = rows(payload.function);
  const middleware = rows(payload.middleware);
  const apps = rows(payload.app);
  const queries = sortedByName(rows(payload.query));
  const tasks = rows(payload.task);
  const addons = rows(payload.addon);
  const toolsets = rows(payload.toolset);
  const tools = rows(payload.tool);
  const triggers = rows(payload.trigger);
  const workflowTests = rows(payload.workflow_test);
  const servers = sortedByName(rows(payload.realtime_server));
  const channels = sortedByName(rows(payload.channel));
  const messages = sortedByName(rows(payload.message));
  const microservices = rows(payload.microservice);
  const actions = rows(payload.run_install);
  const actionPackages = rows(payload.action_package_install);

  return withScriptContext(ctx, () =>
    withRenderState({ verbose: false, quoteMode: null, multilineQuotes: true, multilineTicks: true, multilineForce: false, pipeMode: "pipes", index: 0 }, () => {
      const docs: string[] = [];

      // Pre-register the maps run blocks cross-reference, in the engine's order.
      // The table map is registered whether or not table documents are emitted:
      // on the engine it comes from the request's own setup, not the export.
      register("dbo", byName(dbos));
      if (include.function) {
        ensureNamed(functions, "function");
        register("function", byName(functions));
      }
      if (include.middleware) {
        ensureNamed(middleware, "middleware");
        register("middleware", byName(middleware));
      }
      if (include.addon) {
        ensureNamed(addons, "addon");
        register("addon", byName(addons));
      }
      if (include.task) {
        ensureNamed(tasks, "task");
        register("task", byName(tasks));
      }
      if (include.trigger || include.realtime) {
        const map: Record<string, unknown> = {};
        const realtime = workspace.realtime as Row | undefined;
        for (const channel of rows(realtime?.channels)) map[String(channel.pattern)] = channel.id;
        register("channel", map);
      }
      if (include.ai) {
        ensureNamed(toolsets, "toolset");
        register("toolset", byName(toolsets));
        ensureNamed(tools, "tool");
        register("tool", byName(tools));
      }
      if (include.action) {
        register("action", actionMap(actions));
        register("actionPackage", actionPackageMap(actionPackages));
      }

      // The workspace document.
      docs.push(processConvert("schema:workspace", workspace instanceof StdClass ? {} : workspace).output);

      if (include.table) {
        ensureNamed(dbos, "table");
        processItems("schema:table", dbos, docs);
      }

      if (include.middleware) {
        processItems("schema:middleware", middleware, docs);
        register("middleware", byName(middleware));
      }

      if (include.function) {
        processItems("schema:function", functions, docs);
        register("function", byName(functions));
      }

      if (include.query) {
        ensureNamed(apps, "api_group");
        processItems("schema:api_group", apps, docs);
        register("app", byName(apps));

        ensureNamed(queries, "query");
        processItems("schema:query", queries, docs);
        const map: Record<string, unknown> = {};
        for (const q of queries) map[[q.name, q.verb, refId(q, "app")].join("|")] = rowId(q);
        register("query", map);
      }

      if (include.task) {
        processItems("schema:task", tasks, docs);
        register("task", byName(tasks));
      }

      if (include.addon) {
        processItems("schema:addon", addons, docs);
        register("addon", byName(addons));
      }

      if (include.ai) {
        processItems("schema:agent", toolsets.filter((x) => x.type === "agent"), docs);
        processItems("schema:mcp_server", toolsets.filter((x) => x.type === "mcp"), docs);
        register("toolset", byName(toolsets));
        processItems("schema:tool", tools, docs);
        register("tool", byName(tools));

        const agentIds = toolsets.filter((x) => x.type === "agent").map(rowId);
        const mcpIds = toolsets.filter((x) => x.type === "mcp").map(rowId);
        const matches = (ids: unknown[], id: unknown) => ids.some((i) => (Array.isArray(i) ? i.includes(id) : i === id));
        processItems("schema:agent_trigger", triggers.filter((x) => x.obj_type === "toolset" && matches(agentIds, x.obj_id)), docs);
        processItems("schema:mcp_server_trigger", triggers.filter((x) => x.obj_type === "toolset" && matches(mcpIds, x.obj_id)), docs);
        register("trigger", byName(triggers));
      }

      if (include.workflow_test) {
        ensureNamed(workflowTests, "workflow_test");
        processItems("schema:workflow_test", workflowTests, docs);
        register("workflowTest", byName(workflowTests));
      }

      if (include.realtime) {
        const realtime = workspace.realtime as Row | undefined;
        // Keyed by pattern in insertion order (a Map: an object would hoist a
        // numeric-looking pattern to the front, which the engine does not).
        const unique = new Map<string, Row>();
        for (const item of rows(realtime?.channels)) unique.set(String(item.pattern), item);
        const list = [...unique.values()];
        const map: Record<string, unknown> = {};
        for (const item of list) map[String(item.pattern)] = item.id;
        register("channel", map);
        processItems("schema:realtime_channel", list, docs);
      }

      if (include.realtime_v2) {
        ensureNamed(servers, "realtime_server");
        processItems("schema:realtime_server", servers, docs);
        register("realtimeServer", byName(servers));

        ensureNamed(channels, "channel");
        processItems("schema:channel", channels, docs);
        const channelMap: Record<string, unknown> = {};
        for (const ch of channels) ctx.setV2Channel(channelMap, { id: rowId(ch), name: String(ch.name), server: { id: refId(ch, "server") } });
        register("v2Channel", channelMap);

        ensureNamed(messages, "message");
        processItems("schema:message", messages, docs);
        const messageMap: Record<string, unknown> = {};
        for (const m of messages) messageMap[[m.name, refId(m, "channel")].join("|")] = rowId(m);
        register("message", messageMap);
      }

      if (include.microservice) {
        ensureNamed(microservices, "microservice");
        processItems("schema:microservice", microservices, docs);
      }

      if (include.trigger) {
        ensureNamed(triggers, "trigger");
        processItems("schema:workspace_trigger", triggers.filter((x) => x.obj_type === "workspace"), docs);
        processItems("schema:table_trigger", triggers.filter((x) => x.obj_type === "database"), docs);
        processItems("schema:realtime_trigger", triggers.filter((x) => x.obj_type === "workspace_realtime_channel"), docs);

        const hasV2 = triggers.some((x) => x.obj_type === "realtime_server" || x.obj_type === "channel");
        if (hasV2) {
          register("realtimeServer", byName(servers));
          const channelMap: Record<string, unknown> = {};
          for (const ch of channels) ctx.setV2Channel(channelMap, { id: rowId(ch), name: String(ch.name), server: { id: refId(ch, "server") } });
          register("v2Channel", channelMap);
        }
        processItems("schema:realtime_server_trigger", triggers.filter((x) => x.obj_type === "realtime_server"), docs);
        processItems("schema:channel_trigger", triggers.filter((x) => x.obj_type === "channel"), docs);
        processItems("schema:error_trigger", triggers.filter((x) => x.obj_type === "error"), docs);
        register("trigger", byName(triggers));
      }

      return docs.join("\n---\n");
    }),
  );
}
