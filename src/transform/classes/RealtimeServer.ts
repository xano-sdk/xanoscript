/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:realtime_server";

export function RealtimeServer(data: Record<string, unknown>): KindNode {
  // Legacy/malformed records can have an empty name but a populated canonical;
  // fall back to the canonical (or a placeholder). Mirrors ApiGroup.
  let name = data.name ?? "";
  if (name === "") {
    name = data.canonical ?? "realtime_server_" + strval(data.id ?? "unknown");
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.canonical)) blocks.push(Transform.inlineAssign("canonical", data.canonical));

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  // `enabled` in storage is spelled `active` in script; only emitted when falsy.
  if (phpEmpty(data.enabled)) blocks.push(Transform.inlineAssign("active", data.enabled ?? false, "static:bool"));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.onSchemaRequestHistory(data, ret, "message_enabled", "message_limit");
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
