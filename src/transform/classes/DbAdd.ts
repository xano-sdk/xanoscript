/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { ScriptHelper } from "../../engine/script-helper.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";
import { DB } from "../db.js";

export const KIND = "schema:db.add";

export function DbAdd(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const args = ret.args as KindNode[];
  const blocks = ret.blocks as KindNode[];

  const as = data.as ?? "";
  if (!phpEmpty(as)) {
    const arg = Transform.inlineAssign("as", as);

    const filters: string[] = [];
    for (const filter of Object.values((mapperGet("output.filters", data) ?? []) as object) as Array<Record<string, unknown>>) {
      filters.push(Transform.createInlineFilter(filter, ScriptHelper.isVerbose()));
    }
    if (filters.length) arg.filter = filters.join("|");

    args.push(arg);
  }

  const tableId = mapperGet("context.dbo.id", data);
  let tableName: string;
  try {
    tableName = script().mapIdToDboName(tableId);
  } catch {
    tableName = "";
  }
  args.push(Transform.inlineAssign("name", tableName));

  const enforceHiddenFields = mapperGet("context.enforce_hidden_fields", data) ?? false;
  if (phpEmpty(enforceHiddenFields)) {
    blocks.push(Transform.inlineAssign("enforce_hidden_fields", enforceHiddenFields, "static:bool"));
  }

  blocks.push(Transform.convertFlexInputToBlock(data.input ?? [], "data"));

  DB.onOutput(data.output ?? [], blocks);
  DB.onAddonAssign(data.addon ?? [], blocks);

  return ret;
}
