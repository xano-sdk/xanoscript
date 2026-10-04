/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:addon.call";

export function AddonCall(data: Record<string, unknown>): KindNode {
  let addonName: string;
  try {
    addonName = script().mapIdToAddonName(mapperGet("context.id", data));
  } catch {
    addonName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", addonName)], blocks: [] };

  if (!phpEmpty(data.input)) (ret.blocks as KindNode[]).push(Transform.inputsToObjectBlock(data.input));

  return ret;
}
