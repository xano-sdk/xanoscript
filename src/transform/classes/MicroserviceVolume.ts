/** Port of redacted. */
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:microservice_volume";

export function MicroserviceVolume(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("size", data.size ?? "", "static:text"));
  blocks.push(Transform.inlineAssign("class", data.class ?? "", "static:text"));

  return ret;
}
