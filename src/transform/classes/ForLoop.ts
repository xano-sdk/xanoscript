/** Port of redacted. */
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:for";

export function ForLoop(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const cnt = mapperGet("context.cnt", data, null);
  if (cnt === null) {
    (ret.args as KindNode[]).push({ name: "expr", kind: "assign:int", value: "0" });
  } else {
    const c = cnt as Record<string, unknown>;
    (ret.args as KindNode[]).push({ kind: Transform.convertAssignmentType(String(c.tag ?? "const:null")), name: "expr", ...Transform.parseInlineValue(c) });
  }
  (ret.blocks as KindNode[]).push(
    Transform.onSchemaEachStack({ asvar: mapperGet("context.as", data), stack: mapperGet("context.run", data, []) }, "each"),
  );
  return ret;
}
