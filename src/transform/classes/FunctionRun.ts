/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:function.run";

export function FunctionRun(data: Record<string, unknown>): KindNode {
  const serviceGuid = mapperGet("context.service.guid", data);
  const functionId = mapperGet("context.function.id", data);
  let ret: KindNode;

  if (phpEmpty(serviceGuid)) {
    let functionName: string;
    try {
      functionName = script().mapIdToFunctionName(functionId);
    } catch {
      functionName = "";
    }
    ret = { kind: KIND, args: [Transform.inlineAssign("name", functionName)], blocks: [] };
  } else {
    // The engine resolves the service through its ServiceManager (a live
    // lookup); offline the cached function name is the only source.
    const fallback = mapperGet("context.function.name", data, "") as string;
    ret = { kind: KIND, args: [Transform.inlineAssign("name", fallback)], blocks: [] };
  }

  const runtimeMode = mapperGet("runtime.mode", data, "disabled");
  if (runtimeMode !== "disabled") (ret.blocks as KindNode[]).push(Transform.inlineAssign("runtime_mode", runtimeMode));

  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.convertFlexInputToBlock(data.input));
  return ret;
}
