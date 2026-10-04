/**
 * Port of redacted + redacted: the
 * kind registry (built from the vendored engine YAML), statement aliases,
 * feature flags, the id ↔ name maps every cross-reference resolves through,
 * and the pipe registries.
 */
import kindsJson from "../../vendor/xs-engine/kinds.json" with { type: "json" };
import pipesJson from "../../vendor/xs-engine/pipes.json" with { type: "json" };
import { AssignKind, SchemaKind, StaticKind, type Kind } from "./kinds.js";
import { isAssoc, looseEquals } from "./php.js";
import { TaggedValue } from "./values.js";
import type { PipeMode } from "./state.js";

/** the engine — export-time switches. */
export type Feature = "guid" | "workspaceEnv" | "tableItems";

/** A name → id map, or a lazy loader for one. */
export type NameMap = Record<string, unknown> | (() => Record<string, unknown>);

/** The id → name maps the emitter resolves references through. */
export interface ScriptMaps {
  function?: Record<string, unknown>;
  workflowTest?: Record<string, unknown>;
  app?: Record<string, unknown>;
  /** Keyed `name|verb|app.id`. */
  query?: Record<string, unknown>;
  dbo?: Record<string, unknown>;
  addon?: Record<string, unknown>;
  task?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  tool?: Record<string, unknown>;
  toolset?: Record<string, unknown>;
  middleware?: Record<string, unknown>;
  /** v1 realtime channels, keyed by pattern. */
  channel?: Record<string, unknown>;
  realtimeServer?: Record<string, unknown>;
  /** v2 channels, keyed `server|path`. */
  v2Channel?: Record<string, unknown>;
  /** Keyed `name|channel.id`. */
  message?: Record<string, unknown>;
  action?: Record<string, unknown>;
  actionPackage?: Record<string, unknown>;
}

interface VendoredKinds {
  assign: Record<string, Record<string, unknown> | null>;
  static: Record<string, Record<string, unknown> | null>;
  schema: Record<string, Record<string, unknown> | null>;
}

/** Rehydrate `{ $tag, $value }` markers into TaggedValue instances. */
function hydrate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(hydrate);
  if (isAssoc(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj.$tag === "string" && "$value" in obj && Object.keys(obj).length === 2) {
      return new TaggedValue(obj.$tag, hydrate(obj.$value));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = hydrate(v);
    return out;
  }
  return node;
}

export class ScriptContext {
  private kinds = new Map<string, Kind>();
  private aliases = new Map<string, string>();
  private features: Record<Feature, boolean> = { guid: false, workspaceEnv: false, tableItems: false };
  private maps: Record<keyof ScriptMaps, NameMap> = {
    function: {},
    workflowTest: {},
    app: {},
    query: {},
    dbo: {},
    addon: {},
    task: {},
    trigger: {},
    tool: {},
    toolset: {},
    middleware: {},
    channel: {},
    realtimeServer: {},
    v2Channel: {},
    message: {},
    action: {},
    actionPackage: {},
  };
  /** Every reference a render could not name — the diagnostic a single-def render reports. */
  private unresolved: Array<{ label: string; id: unknown }> = [];
  private readonly pipes: Record<PipeMode, Record<string, string>>;

  constructor() {
    const data = hydrate(kindsJson as unknown) as VendoredKinds;
    this.registerKindAssign(data.assign);
    this.registerKindStatic(data.static);
    this.registerKindSchema(data.schema);
    const p = pipesJson as { pipe: Record<string, string>; filter: Record<string, string>; aggregate: Record<string, string> };
    this.pipes = { pipes: p.pipe, filters: p.filter, aggregates: p.aggregate };
  }

  // --- registry -------------------------------------------------------------

  private registerKindAssign(files: VendoredKinds["assign"]): void {
    for (const [file, raw] of Object.entries(files)) {
      const data = (raw ?? {}) as Record<string, unknown>;
      const label = file.split("/")[0]!;
      const type = file.split("/").pop()!;
      const labels = [...((data.labels as string[]) ?? []), "assign", label];
      const schema = data.schema ?? type;
      const nullable = Boolean(data.nullable ?? false);
      const filter = String(data.filter ?? "");
      this.registerKind(new AssignKind(type, schema, nullable, filter, [...labels, "single"]));
      if (data.listable) {
        this.registerKind(new AssignKind(type + "[]", schema, nullable, filter, [...labels, "list"]));
      }
    }
  }

  private registerKindStatic(files: VendoredKinds["static"]): void {
    for (const [file, raw] of Object.entries(files)) {
      const data = (raw ?? {}) as Record<string, unknown>;
      const type = file.split("/").pop()!;
      const labels = [...((data.labels as string[]) ?? []), "static"];
      this.registerKind(new StaticKind(type, data.schema ?? type, [...labels, "single"]));
      if (data.listable) {
        this.registerKind(new StaticKind(type + "[]", data.schema ?? type, [...labels, "list"]));
      }
    }
  }

  private registerKindSchema(files: VendoredKinds["schema"]): void {
    for (const [file, raw] of Object.entries(files)) {
      const data = (raw ?? {}) as Record<string, unknown>;
      const label = file.split("/")[0]!;
      const type = file.split("/").pop()!;
      const labels = [...((data.labels as string[]) ?? []), "schema", label];
      const alias = (data.alias as string | undefined) ?? null;
      const make = (t: string, withAlias: boolean) =>
        new SchemaKind({
          type: t,
          schema: data.schema ?? t,
          args: data.args ?? [],
          blocks: data.blocks ?? [],
          labels,
          repeating: data.repeating ?? false,
          repeating_blocks: (data.repeating_blocks as unknown[]) ?? [],
          repeating_assignments: (data.repeating_assignments as Record<string, unknown>) ?? {},
          transform: data.transform ?? [],
          alias: withAlias ? alias : null,
          ignoreDefaults: data.ignoreDefaults ?? null,
          force_expanded: Boolean(data.force_expanded ?? false),
          ignoreBlacklist: (data.ignoreBlacklist as string[]) ?? [],
          argNameIsVar: Boolean(data.argNameIsVar ?? false),
          breadcrumb: data.breadcrumb ?? null,
        });
      this.registerKind(make(type, true));
      if (alias) this.setAlias(alias, type);
      if (label === "datatype") this.registerKind(make(type + "[]", false));
    }
  }

  registerKind(kind: Kind): void {
    this.kinds.set(kind.getKind(), kind);
  }

  setAlias(kind: string, alias: string): void {
    this.aliases.set(kind, alias);
  }

  getAlias(alias: string): string | null {
    return this.aliases.get(alias) ?? null;
  }

  getKind(kind: string): Kind {
    const k = this.kinds.get(kind);
    if (!k) throw new Error("Invalid kind1: " + kind);
    return k;
  }

  /** Kind names carrying ALL the given labels, in registration order. */
  getKinds(labels: string[] | string = []): string[] {
    const want = typeof labels === "string" ? [labels] : labels;
    const out: string[] = [];
    for (const [name, kind] of this.kinds) {
      if (want.length === 0 || want.every((l) => kind.getLabels().includes(l))) out.push(name);
    }
    return out;
  }

  // --- features -------------------------------------------------------------

  getFeature(feature: Feature): boolean {
    return this.features[feature];
  }

  setFeature(feature: Feature, value: boolean): void {
    this.features[feature] = value;
  }

  setFeatures(features: Record<Feature, boolean>): void {
    this.features = { ...features };
  }

  // --- maps -----------------------------------------------------------------

  registerMap(name: keyof ScriptMaps, map: NameMap): void {
    this.maps[name] = map;
    this.reverse.delete(name);
  }

  /**
   * Per-map reverse index (`String(id or alias)` → first name carrying it),
   * built on first lookup and dropped when the map is replaced. A multidoc
   * resolves one reference per statement against maps holding every object of
   * the workspace, so the plain scan is O(references × objects); the index is
   * the same answer in O(1) for the string/number ids every map carries. The
   * loose scan remains the fallback for the rest ("05" is 5 to the engine).
   */
  private reverse = new Map<keyof ScriptMaps, { source: Record<string, unknown>; byId: Map<string, string> }>();

  private reverseIndex(name: keyof ScriptMaps): Map<string, string> {
    const map = this.getMap(name);
    const cached = this.reverse.get(name);
    if (cached && cached.source === map) return cached.byId;
    const byId = new Map<string, string>();
    for (const [k, v] of Object.entries(map)) {
      for (const alias of Array.isArray(v) ? v : [v]) {
        if (typeof alias !== "string" && typeof alias !== "number" && typeof alias !== "bigint") continue;
        const key = String(alias);
        if (!byId.has(key)) byId.set(key, k);
      }
    }
    this.reverse.set(name, { source: map, byId });
    return byId;
  }

  /** The map key whose value (or alias) equals `id`, by index first, then by the engine's loose compare. */
  private keyForId(name: keyof ScriptMaps, id: unknown): string | undefined {
    if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") {
      const hit = this.reverseIndex(name).get(String(id));
      if (hit !== undefined) return hit;
    }
    for (const [k, v] of Object.entries(this.getMap(name))) {
      if (Array.isArray(v) ? v.some((alias) => looseEquals(alias, id)) : looseEquals(v, id)) return k;
    }
    return undefined;
  }

  registerMaps(maps: ScriptMaps): void {
    for (const [name, map] of Object.entries(maps)) {
      if (map) this.registerMap(name as keyof ScriptMaps, map);
    }
  }

  getMap(name: keyof ScriptMaps): Record<string, unknown> {
    const map = this.maps[name];
    if (typeof map === "function") {
      const loaded = map();
      this.maps[name] = loaded;
      return loaded;
    }
    return map;
  }

  /** The references no map could name since the last call, oldest first; clears the record. */
  takeUnresolved(): Array<{ label: string; id: unknown }> {
    const out = this.unresolved;
    this.unresolved = [];
    return out;
  }

  /**
   * A map value is the object's id, or a list of aliases for it: an SDK bundle
   * references objects by guid while a pulled workspace uses numeric ids, so a
   * row that carries both registers both and resolves from either.
   */
  private idToName(name: keyof ScriptMaps, id: unknown, doThrow: boolean, label: string): string {
    const key = this.keyForId(name, id);
    if (key !== undefined) return key;
    // Recorded whether the caller throws or blanks: an encoder that catches the
    // throw and renders "" is still a reference the output could not name.
    this.unresolved.push({ label, id });
    if (doThrow) throw new Error(`Invalid ${label} id: ${safeString(id)}`);
    return "";
  }

  mapIdToFunctionName(id: unknown): string {
    return this.idToName("function", id, true, "function");
  }
  mapIdToWorkflowTestName(id: unknown): string {
    return this.idToName("workflowTest", id, true, "workflow test");
  }
  mapIdToAppName(id: unknown, doThrow = true): string {
    return this.idToName("app", id, doThrow, "app");
  }
  mapIdToQuery(id: unknown): string {
    return this.idToName("query", id, true, "query");
  }
  parseQuery(query: string): { name: string; verb: string; appId: string } {
    const [name = "", verb = "", appId = ""] = query.split("|");
    return { name, verb, appId };
  }
  mapIdToDboName(id: unknown, doThrow = true): string {
    if (id === null || id === undefined || typeof id === "object") {
      if (doThrow) throw new Error(`Invalid dbo id: ${safeString(id)}`);
      return "";
    }
    return this.idToName("dbo", id, doThrow, "dbo");
  }
  mapIdToAddonName(id: unknown): string {
    return this.idToName("addon", id, true, "addon");
  }
  mapIdToTaskName(id: unknown): string {
    return this.idToName("task", id, true, "task");
  }
  mapIdToTriggerName(id: unknown): string {
    return this.idToName("trigger", id, true, "trigger");
  }
  mapIdToToolName(id: unknown): string {
    return this.idToName("tool", id, true, "tool");
  }
  mapIdToToolsetName(id: unknown, doThrow = true): string {
    return this.idToName("toolset", id, doThrow, "toolset");
  }
  mapIdToMiddlewareName(id: unknown): string {
    return this.idToName("middleware", id, true, "middleware");
  }
  mapIdToChannelName(id: unknown, doThrow = true): string {
    return this.idToName("channel", id, doThrow, "channel");
  }
  mapIdToRealtimeServerName(id: unknown, doThrow = true): string {
    return this.idToName("realtimeServer", id, doThrow, "realtime_server");
  }
  v2ChannelMapKey(serverName: unknown, channelPath: unknown): string {
    return `${String(serverName ?? "")}|${String(channelPath ?? "")}`;
  }
  mapIdToV2ChannelName(id: unknown, doThrow = true): string {
    const k = this.keyForId("v2Channel", id);
    if (k === undefined) this.unresolved.push({ label: "channel", id });
    if (k !== undefined) {
      const sep = k.indexOf("|");
      return sep === -1 ? k : k.substring(sep + 1);
    }
    if (doThrow) throw new Error(`Invalid channel id: ${safeString(id)}`);
    return "";
  }
  mapIdToV2ChannelServerName(id: unknown, doThrow = true): string {
    const k = this.keyForId("v2Channel", id);
    if (k === undefined) this.unresolved.push({ label: "channel", id });
    if (k !== undefined) {
      const sep = k.indexOf("|");
      return sep === -1 ? "" : k.substring(0, sep);
    }
    if (doThrow) throw new Error(`Invalid channel id: ${safeString(id)}`);
    return "";
  }
  actionNameOf(id: unknown): string {
    return this.idToName("action", id, true, "action");
  }
  actionPackageNameOf(id: unknown): string {
    return this.idToName("actionPackage", id, true, "action package");
  }

  /** `setV2Channel`: key by `{serverName}|{path}` resolving the server through the server map. */
  setV2Channel(map: Record<string, unknown>, item: { id: unknown; name: string; server?: { id?: unknown } }): void {
    const serverId = item.server?.id ?? 0;
    const serverName = serverId ? this.mapIdToRealtimeServerName(serverId, false) : "";
    map[this.v2ChannelMapKey(serverName, item.name)] = item.id;
  }

  // --- pipes ----------------------------------------------------------------

  getPipeDisplay(mode: PipeMode, name: string): string | null {
    const map = this.pipes[mode];
    return Object.prototype.hasOwnProperty.call(map, name) ? map[name]! : null;
  }

  getPipeInternalNames(mode: PipeMode): string[] {
    return Object.keys(this.pipes[mode]);
  }
}

function safeString(v: unknown): string {
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return String(v);
}
