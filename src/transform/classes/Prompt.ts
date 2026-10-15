/**
 * Port of redacted: an MCP prompt whose stack produces
 * its messages. Mirrors `tool` block for block and reuses its `title` /
 * `icons` helpers so the two kinds cannot drift.
 */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";
import { onIcons, onTitle } from "./Tool.js";

export const KIND = "schema:prompt";

export function Prompt(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  onTitle(data, ret);
  onIcons(data, ret);

  blocks.push(Transform.convertToKind("schema:input", data.input ?? []));
  blocks.push(Transform.convertToKind("schema:stack", data.run ?? []));
  blocks.push(Transform.onSchemaResponse(data));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
