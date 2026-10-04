/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:conditional";

export function Conditional(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(
    Transform.convertStackItem("schema:ifstack", {
      name: "if",
      description: mapperGet("context.if.description", data, ""),
      expr: mapperGet("context.expr", data, null),
      stack: mapperGet("context.if.run", data, []),
    }),
  );

  const elseIfs = (mapperGet("context.elif.run", data, []) as unknown[]) ?? [];
  for (const elseIf of elseIfs as Array<Record<string, unknown>>) {
    if ((elseIf.name ?? "") !== "mvp:conditional_elif") continue;
    blocks.push(
      Transform.convertStackItem("schema:elseifstack", {
        name: "elseif",
        disabled: elseIf.disabled ?? false,
        description: elseIf.description ?? "",
        expr: mapperGet("context.expr", elseIf, null),
        stack: mapperGet("context.if.run", elseIf, []),
      }),
    );
  }

  const elseRun = mapperGet("context.else.run", data, []);
  const elseDescription = mapperGet("context.else.description", data, "");
  if (!phpEmpty(elseRun) || !phpEmpty(elseDescription)) {
    blocks.push(Transform.convertStackItem("schema:elsestack", { name: "else", description: elseDescription, stack: elseRun }));
  }

  return ret;
}
