/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:function";

export function FunctionTransform(data: Record<string, unknown>): KindNode {
  try {
    Transform.pushContext(data);
    const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
    const blocks = ret.blocks as KindNode[];

    if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

    blocks.push(Transform.convertToKind("schema:input", data.input));
    blocks.push(Transform.convertToKind("schema:stack", data.run));
    blocks.push(Transform.onSchemaResponse(data));

    if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

    Transform.createToSchemaTableTags(ret, data.tag ?? []);
    Transform.onSchemaRequestHistory(data, ret);
    Transform.onSchemaCache(data, ret);
    Transform.onSchemaTesting(data, ret);
    Transform.onSchemaMiddlewareMapping(data, ret);

    if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

    return ret;
  } finally {
    Transform.popContext();
  }
}
