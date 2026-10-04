/** Port of redacted. */
import { Parser } from "../../engine/parser.js";
import { StdClass, isPhpArray, phpEmpty } from "../../engine/php.js";
import { ScriptHelper } from "../../engine/script-helper.js";
import { RawValue } from "../../engine/values.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:array.map";

/** PHP `(array) $data["context"]`: stdClass/null cast to an empty array, arrays pass through. */
function contextArray(v: unknown): Record<string, unknown> {
  if (isPhpArray(v)) return v as Record<string, unknown>;
  if (v === null || v === undefined || v instanceof StdClass) return {};
  return { 0: v };
}

export function ArrayMap(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const args = ret.args as KindNode[];
  const blocks = ret.blocks as KindNode[];

  const ctx = contextArray(data.context);

  const value = mapperGet("collection", ctx);
  if (phpEmpty(value)) {
    args.push({ name: "expr", kind: "assign:text[]", value: [] });
  } else {
    const v = value as Record<string, unknown>;
    args.push({ name: "expr", kind: Transform.convertAssignmentType(String(v.tag)), ...Transform.parseInlineValue(v) });
  }

  const outputType = ctx.output_type ?? "value";

  switch (outputType) {
    case "value":
      if (!phpEmpty(ctx.transform_value)) {
        blocks.push(Transform.convertAssignmentValue(ctx.transform_value, "by"));
      } else {
        blocks.push(Transform.inlineAssign("by", "$this", "assign:var"));
      }
      break;
    case "object":
      if (!phpEmpty(ctx.transform_object) && isPhpArray(ctx.transform_object)) {
        const obj: KindNode = { kind: "assign:expr", name: "by", value: [] };

        const parts: Record<string, unknown> = {};

        for (const item of Object.values(ctx.transform_object as object) as Array<Record<string, unknown>>) {
          let key = Transform.createInlineValue(item.attribute_key, { name: "value", tag: ScriptHelper.isVerbose(), raw: false, wrapIfExpression: false });
          const itemValue = Transform.createInlineValue(item.attribute_value, { name: "value", tag: ScriptHelper.isVerbose(), raw: false, wrapIfExpression: false });

          if (Parser.isWrappedInQuotes(key)) {
            key = Parser.stripQuotes(key) as string;
          }

          if (!phpEmpty((item.attribute_key as Record<string, unknown> | undefined)?.filters)) {
            key = "(" + key + ")";
          }

          parts[key] = new RawValue(itemValue);
        }

        obj.value = ScriptHelper.wrap(parts, true, null, "scalar", 1, false);
        blocks.push(obj);
      } else {
        blocks.push({ kind: "assign:var", name: "by", value: "$this" });
      }
      break;
  }

  return ret;
}
