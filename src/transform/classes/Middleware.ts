/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:middleware";

/** The fixed `input { json vars; enum type }` block the PHP `json_decode`s inline. */
function inputBlock(): KindNode {
  return {
    kind: "schema:input",
    blocks: [
      {
        kind: "schema:json",
        args: [{ name: "name", kind: "static:text", value: "vars" }],
      },
      {
        kind: "schema:enum",
        args: [{ name: "name", kind: "static:text", value: "type" }],
        blocks: [{ kind: "static:text[]", name: "values", value: ["pre", "post"] }],
      },
    ],
  };
}

export function Middleware(data: Record<string, unknown>): KindNode {
  try {
    Transform.pushContext(data);
    const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name)], blocks: [] };
    const blocks = ret.blocks as KindNode[];

    if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

    blocks.push(inputBlock());

    blocks.push(Transform.convertToKind("schema:stack", data.run));
    blocks.push(Transform.onSchemaResponse(data));

    if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

    let responseStrategy = data.result_type ?? null;
    if (phpEmpty(responseStrategy)) responseStrategy = "merge";
    blocks.push(Transform.inlineAssign("response_strategy", responseStrategy));

    // The PHP assigns the "silent" fallback to a mistyped variable ($response_policy), so an
    // empty exception policy is emitted as-is. Kept byte-for-byte.
    const exceptionPolicy = data.exception ?? null;
    blocks.push(Transform.inlineAssign("exception_policy", exceptionPolicy));

    Transform.createToSchemaTableTags(ret, data.tag ?? []);
    Transform.onSchemaRequestHistory(data, ret);
    Transform.onSchemaTesting(data, ret);

    if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

    return ret;
  } finally {
    Transform.popContext();
  }
}
