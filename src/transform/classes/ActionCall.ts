/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:action.call";

export function ActionCall(data: Record<string, unknown>): KindNode {
  const version = mapperGet("context.run_version.id", data) ?? "";

  let actionName: string;
  try {
    actionName = script().actionNameOf(version);
  } catch {
    actionName = "";
  }

  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", actionName)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.input)) blocks.push(Transform.inputsToObjectBlock(data.input));

  const settingsRegistry = Transform.dropRegistryDefaults(Object.values((data.settings_registry ?? []) as object));
  if (!phpEmpty(settingsRegistry)) blocks.push(Transform.inputsToObjectBlock(settingsRegistry, "registry"));

  return ret;
}
