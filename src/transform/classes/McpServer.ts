/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:mcp_server";

export function McpServer(data: Record<string, unknown>): KindNode {
  // `?? ""` before the `?:` chain: the key can be ABSENT, not merely empty.
  const nameRaw = data.name ?? "";
  const name = !phpEmpty(nameRaw) ? nameRaw : (data.canonical ?? data.guid ?? "unnamed");

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.enabled)) blocks.push(Transform.inlineAssign("active", false, "static:bool"));
  blocks.push(Transform.inlineAssign("canonical", data.canonical ?? null));

  if (!phpEmpty(data.instructions)) blocks.push(Transform.inlineAssign("instructions", data.instructions));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  Transform.onSchemaToolMapping(data, ret);
  Transform.onSchemaRequestHistory(data, ret, "tool_enabled", "tool_limit");

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
