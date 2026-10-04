/** Port of redacted. */
import { StdClass, isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:array.union";

/** PHP `(array) $data["context"]`: stdClass/null cast to an empty array, arrays pass through. */
function contextArray(v: unknown): Record<string, unknown> {
  if (isPhpArray(v)) return v as Record<string, unknown>;
  if (v === null || v === undefined || v instanceof StdClass) return {};
  return { 0: v };
}

export function ArrayUnion(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const args = ret.args as KindNode[];
  const blocks = ret.blocks as KindNode[];

  const ctx = contextArray(data.context);

  const value = mapperGet("left", ctx);
  if (phpEmpty(value)) {
    args.push({ name: "expr", kind: "assign:text[]", value: [] });
  } else {
    const v = value as Record<string, unknown>;
    args.push({ name: "expr", kind: Transform.convertAssignmentType(String(v.tag)), ...Transform.parseInlineValue(v) });
  }

  if (!phpEmpty(ctx.right)) {
    blocks.push(Transform.convertAssignmentValue(ctx.right, "value"));
  } else {
    blocks.push(Transform.inlineAssign("value", "[]", "assign:array"));
  }

  if (!phpEmpty(ctx.transform_value)) {
    blocks.push(Transform.convertAssignmentValue(ctx.transform_value, "by"));
  } else {
    blocks.push(Transform.inlineAssign("by", "$this", "assign:var"));
  }

  return ret;
}
