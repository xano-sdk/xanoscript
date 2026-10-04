/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:chart";

export function MicroserviceChart(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  // ref/version/values are each optional — emit only when set.
  if (!phpEmpty(data.ref)) blocks.push(Transform.inlineAssign("ref", data.ref, "static:text"));

  if (!phpEmpty(data.version)) blocks.push(Transform.inlineAssign("version", data.version, "static:text"));

  // values: the Helm values blob, emitted VERBATIM.
  if (!phpEmpty(data.values)) blocks.push(Transform.inlineAssign("values", data.values, "static:text"));

  return ret;
}
