/** Port of redacted. */
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:microservice_config";

export function MicroserviceConfig(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? "")], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("type", data.type ?? "", "static:text"));
  blocks.push(Transform.inlineAssign("value", data.value ?? "", "static:text"));

  return ret;
}
