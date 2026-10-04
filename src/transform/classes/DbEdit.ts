/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { ScriptHelper } from "../../engine/script-helper.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";
import { DB } from "../db.js";

export const KIND = "schema:db.edit";

export function DbEdit(data: Record<string, unknown>): KindNode {
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

  const input = Object.values((data.input ?? []) as object) as Array<Record<string, unknown>>;

  for (const entry of input) {
    if ((entry.name ?? "") === "field_name") {
      blocks.push(Transform.convertAssignmentValue(entry, "field_name"));
      break;
    }
  }

  let hasFieldValue = false;
  for (const entry of input) {
    if ((entry.name ?? "") === "field_value") {
      blocks.push(Transform.convertAssignmentValue(entry, "field_value"));
      hasFieldValue = true;
      break;
    }
  }

  // field_value is a required block; legacy/incomplete dbo_editby records may have no input
  // at all. Emit an empty placeholder so the export validates instead of aborting the whole
  // workspace export.
  if (!hasFieldValue) {
    blocks.push(Transform.inlineAssign("field_value", ""));
  }

  const enforceHiddenFields = mapperGet("context.enforce_hidden_fields", data) ?? false;
  if (phpEmpty(enforceHiddenFields)) {
    blocks.push(Transform.inlineAssign("enforce_hidden_fields", enforceHiddenFields, "static:bool"));
  }

  blocks.push(Transform.convertFlexInputToBlock(data.input ?? [], "data"));

  DB.onOutput(data.output ?? [], blocks);
  DB.onAddonAssign(data.addon ?? [], blocks);

  return ret;
}
