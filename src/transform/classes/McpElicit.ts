/**
 * Port of redacted: `mcp.elicit { key, message,
 * input { ... } } as $answer`. The `input` block is the same grammar (and
 * kind) as a tool's, stored under `context.schema`. Which types it may carry
 * is a run-time rule, never the encoder's: an encoder must not throw.
 */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:mcp.elicit";

export function McpElicit(dataIn: Record<string, unknown>): KindNode {
  // A stored `{}` reaches an encoder as an empty object it cannot index.
  const data = Transform.objectToArray(dataIn) as Record<string, unknown>;
  const context = Transform.objectToArray(data.context ?? []) as Record<string, unknown>;

  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  Transform.onAs(data, ret.args as KindNode[]);

  for (const name of ["key", "message"]) {
    const entry = findInput(data.input ?? [], name);
    // Both blocks are required; an incomplete record must still export.
    blocks.push(entry !== null ? Transform.convertAssignmentValue(entry, name) : Transform.inlineAssign(name, ""));
  }

  const schema = Transform.objectToArray(context.schema ?? []);
  if (!phpEmpty(schema)) {
    try {
      blocks.push(Transform.onSchemaInput(schema));
    } catch {
      // a throw would drop the whole containing object
    }
  }

  return ret;
}

function findInput(input: unknown, name: string): Record<string, unknown> | null {
  for (const entryIn of Object.values((Transform.objectToArray(input) ?? []) as object)) {
    const entry = Transform.objectToArray(entryIn) as Record<string, unknown>;
    if ((entry?.name ?? "") === name) return entry;
  }
  return null;
}
