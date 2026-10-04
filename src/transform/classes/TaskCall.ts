/** Port of redacted. */
import { script } from "../../engine/context.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:task.call";

export function TaskCall(data: Record<string, unknown>): KindNode {
  let task: string;
  try {
    task = script().mapIdToTaskName(mapperGet("context.id", data));
  } catch {
    task = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", task)], blocks: [] };

  return ret;
}
