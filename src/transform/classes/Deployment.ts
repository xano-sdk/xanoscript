/** Port of redacted. */
import { intval, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:deployment";

export function Deployment(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  // replicas defaults to 1 — only emit when scaled above the default.
  const replicas = intval(data.replicas ?? 1);
  if (replicas > 1) blocks.push(Transform.inlineAssign("replicas", replicas, "static:int"));

  // docker: optional — only emit when set.
  if (!phpEmpty(data.docker)) blocks.push(Transform.inlineAssign("docker", data.docker, "static:text"));

  // strategy defaults to "Recreate" — only emit when overridden.
  const strategy = data.strategy ?? "Recreate";
  if (strategy !== "" && strategy !== "Recreate") blocks.push(Transform.inlineAssign("strategy", strategy, "static:text"));

  for (const container of Object.values((data.containers ?? []) as object)) {
    blocks.push(Transform.convertToKind("schema:container", container));
  }

  return ret;
}
