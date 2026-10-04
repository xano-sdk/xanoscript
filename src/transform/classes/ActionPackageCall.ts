/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";
import { KIND as ACTION_CALL_KIND } from "./ActionCall.js";

export const KIND = "schema:action.package.call";

export function ActionPackageCall(data: Record<string, unknown>): KindNode {
  const traceId = mapperGet("context.action.trace_id", data) ?? "";
  const versionId = mapperGet("context.package_version.id", data) ?? "";
  const slug = mapperGet("context.package.slug", data) ?? "";

  const packageId = [traceId, versionId, slug].map((v) => strval(v)).join("|");

  let packageName: string;
  let actionName: string;
  try {
    const name = script().actionPackageNameOf(packageId).split("|");
    packageName = name.shift() ?? "";
    actionName = name.join("|");
  } catch {
    packageName = "";
    actionName = "";
  }

  // Rewritten to the plain `action.call` kind, exactly as the engine does.
  const ret: KindNode = { kind: ACTION_CALL_KIND, args: [Transform.inlineAssign("name", actionName)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("package", packageName));

  if (!phpEmpty(data.input)) blocks.push(Transform.inputsToObjectBlock(data.input));

  const settingsRegistry = Transform.dropRegistryDefaults(Object.values((data.settings_registry ?? []) as object));
  if (!phpEmpty(settingsRegistry)) blocks.push(Transform.inputsToObjectBlock(settingsRegistry, "registry"));

  return ret;
}
