/** Port of redacted. */
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:run.job";

export function RunJob(data: Record<string, unknown>): KindNode {
  const ret: KindNode = { kind: KIND, args: [Transform.inlineAssign("name", data.name ?? null)], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  onMain(data, ret);
  onPre(data, ret);
  onPost(data, ret);

  if (!phpEmpty(data.env)) blocks.push(Transform.inlineAssign("env", data.env, "static:text[]"));

  return ret;
}

/** the engine's `onMain`. */
function onMain(item: Record<string, unknown>, schema: KindNode): void {
  const key = "main";

  if (phpEmpty(item[key])) return;
  const main = item[key] as Record<string, unknown>;

  const node: KindNode[] = [];
  node.push(Transform.inlineAssign("name", main.name ?? null));
  node.push(Transform.inlineAssign("input", main.input ?? null, "static:json"));

  for (const field of ["as"]) {
    if (!phpEmpty(main[field])) node.push(Transform.inlineAssign(field, main[field]));
  }

  (schema.blocks as KindNode[]).push(Transform.inlineAssign(key, node, "static:object"));
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

/** the engine's `onPost` — the engine iterates an EMPTY extra-field list here, so only `name` is emitted. */
function onPost(item: Record<string, unknown>, schema: KindNode): void {
  const key = "post";

  if (phpEmpty(item[key])) return;
  const post = item[key] as Record<string, unknown>;

  const node: KindNode[] = [];
  node.push(Transform.inlineAssign("name", post.name ?? null));

  (schema.blocks as KindNode[]).push(Transform.inlineAssign(key, node, "static:object"));
}
