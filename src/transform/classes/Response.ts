/** Port of redacted. */
import { Parser } from "../../engine/parser.js";
import { isPhpArray, phpEmpty } from "../../engine/php.js";
import { ScriptHelper } from "../../engine/script-helper.js";
import { RawValue } from "../../engine/values.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:response";

export function Response(orig: Record<string, unknown>): KindNode {
  const data = (orig.result ?? orig) as unknown;
  const ret: KindNode = { kind: KIND, blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if ((orig.response_type ?? "") === "stream") {
    blocks.push(Transform.inlineAssign("type", "stream"));
    return ret;
  }

  if (isPhpArray(data) && !phpEmpty(data)) {
    const obj: KindNode = { kind: "assign:object", name: "value", value: {} };
    const value = obj.value as Record<string, unknown>;
    let last: Record<string, unknown> = {};
    const list = Object.values(data as object) as Array<Record<string, unknown>>;
    for (const v of list) {
      last = v;
      const raw = Transform.createInlineValue(v, { name: "value", tag: ScriptHelper.isVerbose(), raw: false, wrapIfExpression: false });
      let name = String(v.name ?? "");
      if (v.disabled) name = "!" + Parser.wrapText(name);
      value[name] = new RawValue(raw);
    }
    if (Object.keys(value).length === 1 && phpEmpty(last.name)) {
      blocks.push(Transform.convertAssignmentValue(list[0] ?? null));
    } else {
      blocks.push(obj);
    }
  } else {
    blocks.push({ kind: "assign:null", name: "value", value: "null" });
  }
  return ret;
}
