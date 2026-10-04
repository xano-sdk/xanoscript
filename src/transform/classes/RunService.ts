/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:run.service";

export function RunService(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  onPre(data, ret);

  if (!phpEmpty(data.env)) blocks.push(Transform.inlineAssign("env", data.env, "static:text[]"));

  return ret;
}

/** the engine's `onPre`. */
function onPre(item: Record<string, unknown>, schema: KindNode): void {
  const key = "pre";

  if (phpEmpty(item[key])) return;
  const pre = item[key] as Record<string, unknown>;

  const node: KindNode[] = [];
  node.push(Transform.inlineAssign("name", pre.name ?? null));

  for (const field of ["as"]) {
    if (!phpEmpty(pre[field])) node.push(Transform.inlineAssign(field, pre[field]));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign(key, node, "static:object"));
}
