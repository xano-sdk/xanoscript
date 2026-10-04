/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:middleware.call";

export function MiddlewareCall(data: Record<string, unknown>): KindNode {
  let middlewareName: string;
  try {
    middlewareName = script().mapIdToMiddlewareName(mapperGet("context.id", data));
  } catch {
    middlewareName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", middlewareName)], blocks: [] };

  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.inputsToObjectBlock(data.input));

  return ret;
}
