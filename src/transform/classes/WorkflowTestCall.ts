/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:workflow_test.call";

export function WorkflowTestCall(data: Record<string, unknown>): KindNode {
  let workflowTestName: string;
  try {
    workflowTestName = script().mapIdToWorkflowTestName(mapperGet("context.id", data));
  } catch {
    workflowTestName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", workflowTestName)], blocks: [] };

  const datasource = mapperGet("context.datasource", data);
  if (!phpEmpty(datasource)) (ret.blocks as KindNode[]).push(Transform.inlineAssign("datasource", datasource));

  return ret;
}
