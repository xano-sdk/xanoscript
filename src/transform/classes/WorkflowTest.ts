/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:workflow_test";

export function WorkflowTest(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (!phpEmpty(data.datasource)) blocks.push(Transform.inlineAssign("datasource", data.datasource, "static:text"));

  blocks.push(Transform.convertToKind("schema:stack", data.run));
  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
