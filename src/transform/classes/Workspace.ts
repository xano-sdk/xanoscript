/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:workspace";

const PREFERENCE_MAP: Record<string, string> = {
  internal_docs: "preferences.use_internal_docs",
  track_performance: "preferences.track_performance",
  sql_names: "use_custom_names",
  sql_columns: "!use_xdo",
};

const ACCEPTANCE_MAP: Record<string, string> = {
  ai_terms: "settings.ai_enabled",
};

export function Workspace(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", phpEmpty(data.name ?? "") ? "Untitled" : data.name)],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  // The engine's "workspace lite" export feature is not part of the port's feature set; its
  // default (off) applies, so the acceptance and preference blocks always render.
  onAcceptance(data, ret);
  onPreferences(data, ret);
  onRealtime(data, ret);

  if (script().getFeature("workspaceEnv")) {
    onEnv(data, ret);
  }

  return ret;
}

/** The `onPreferences` helper of the PHP Workspace transform. */
function onPreferences(item: Record<string, unknown>, schema: KindNode): void {
  const prefs: KindNode[] = [];

  for (const [xsKey, jsonKey] of Object.entries(PREFERENCE_MAP)) {
    prefs.push(onMapValue(xsKey, jsonKey, item));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("preferences", prefs, "static:object"));
}

/** The `onRealtime` helper of the PHP Workspace transform. */
function onRealtime(item: Record<string, unknown>, schema: KindNode): void {
  const prefs: KindNode[] = [];

  const ret = mapperGet("realtime.enabled", item);
  if (phpEmpty(ret)) return;

  const value = mapperGet("realtime.hash", item, "");
  prefs.push(Transform.inlineAssign("canonical", value));

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("realtime", prefs, "static:object"));
}

/** The `onEnv` helper of the PHP Workspace transform. */
function onEnv(item: Record<string, unknown>, schema: KindNode): void {
  const envs: KindNode[] = [];

  for (const env of Object.values((item.env ?? []) as object) as Array<Record<string, unknown>>) {
    envs.push(Transform.inlineAssign(env.name as string, env.value));
  }

  if (!phpEmpty(envs)) {
    (schema.blocks as KindNode[]).push(Transform.inlineAssign("env", envs, "static:object"));
  }
}

/** The `onAcceptance` helper of the PHP Workspace transform. */
function onAcceptance(item: Record<string, unknown>, schema: KindNode): void {
  const prefs: KindNode[] = [];

  for (const [xsKey, jsonKey] of Object.entries(ACCEPTANCE_MAP)) {
    prefs.push(onMapValue(xsKey, jsonKey, item));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign("acceptance", prefs, "static:object"));
}

/** The `onMapValue` helper of the PHP Workspace transform. */
function onMapValue(xsKey: string, jsonKeyIn: string, item: Record<string, unknown>): KindNode {
  let jsonKey = jsonKeyIn;
  let fallback: boolean = false;
  const negate = jsonKey.startsWith("!");
  if (negate) {
    jsonKey = jsonKey.substring(1);
    fallback = true;
  }

  let value = mapperGet(jsonKey, item, fallback);
  if (negate) {
    value = phpEmpty(value);
  }
  return Transform.inlineAssign(xsKey, value, "static:bool");
}
