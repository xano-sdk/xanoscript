/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:addon";

export function Addon(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  blocks.push(Transform.convertToKind("schema:input", data.input));

  const dboView = {
    name: "mvp:dbo_view",
    as: "",
    context: data.context,
    output: data.output ?? null,
  };

  blocks.push(Transform.convertToKind("schema:stack", [dboView]));
  Transform.createToSchemaTableTags(ret, data.tag ?? []);
  // The PHP carries a commented-out output-block call here; nothing is emitted for it.

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}
