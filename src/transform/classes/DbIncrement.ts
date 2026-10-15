/**
 * Port of redacted: `db.increment <table> { where,
 * field_name, value, return, output, addon } as $x`.
 *
 * The where renders under the FILTERS pipe mode (a where pipe is a filter).
 * A stored record may carry no where (the stack UI saves the statement before
 * the author sets one); it renders with no where block.
 */
import { script } from "../../engine/context.js";
import { Transform, type KindNode } from "../transform.js";
import { DB } from "../db.js";

export const KIND = "schema:db.increment";

/** The statement's list return type, the one that renders no `return` block. */
const RETURN_LIST = "list";

export function DbIncrement(dataIn: Record<string, unknown>): KindNode {
  // A stored `{}` reaches an encoder as an empty object it cannot index.
  const data = { ...(Transform.objectToArray(dataIn) as Record<string, unknown>) };
  const context = { ...(Transform.objectToArray(data.context ?? []) as Record<string, unknown>) };
  context.dbo = Transform.objectToArray(context.dbo ?? []);
  data.context = context;

  let tableName: string;
  try {
    tableName = script().mapIdToDboName((context.dbo as Record<string, unknown>).id ?? null);
  } catch {
    tableName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", tableName)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  Transform.onAs(data, ret.args as KindNode[]);

  const MODE = Transform.getPipeMode();
  try {
    Transform.setPipeMode(Transform.PIPE_MODE_FILTERS);
    const renameMap = DB.getNormalizedMap(data);
    DB.onSearch(context.search ?? [], blocks, renameMap);
  } finally {
    Transform.setPipeMode(MODE);
  }

  for (const name of ["field_name", "value"]) {
    const entry = findInput(data.input ?? [], name);

    if (entry !== null) {
      blocks.push(Transform.convertAssignmentValue(entry, name));
    } else {
      // Both blocks are required; an incomplete record must still export.
      blocks.push(name === "value" ? Transform.inlineAssign("value", 0, "assign:int") : Transform.inlineAssign("field_name", ""));
    }
  }

  const ret_ = Transform.objectToArray(context.return ?? []) as Record<string, unknown>;
  const type = ret_.type ?? RETURN_LIST;
  if (type !== RETURN_LIST && type !== "") {
    blocks.push({ name: "return", kind: "static:object", value: [Transform.inlineAssign("type", type)] });
  }

  DB.onOutput(data.output ?? [], blocks);
  DB.onAddonAssign(Transform.objectToArray(data.addon ?? []), blocks);

  return ret;
}

function findInput(input: unknown, name: string): Record<string, unknown> | null {
  for (const entryIn of Object.values((Transform.objectToArray(input) ?? []) as object)) {
    const entry = Transform.objectToArray(entryIn) as Record<string, unknown>;
    if ((entry?.name ?? "") === name) return entry;
  }
  return null;
}
