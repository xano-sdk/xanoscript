/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:tool";

export function Tool(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (!phpEmpty(data.instructions)) blocks.push(Transform.inlineAssign("instructions", data.instructions));

  blocks.push(Transform.convertToKind("schema:input", data.input));
  blocks.push(Transform.convertToKind("schema:stack", data.run));
  blocks.push(Transform.onSchemaResponse(data));

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);
  Transform.onSchemaMiddlewareMapping(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
