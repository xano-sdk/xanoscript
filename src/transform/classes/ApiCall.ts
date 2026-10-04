/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:api.call";

export function ApiCall(data: Record<string, unknown>): KindNode {
  let query: { name: string; verb: string; appId: unknown };
  try {
    query = script().parseQuery(script().mapIdToQuery(mapperGet("context.id", data)));
  } catch {
    query = { name: "", verb: "GET", appId: 0 };
  }

  let apiGroup: string;
  try {
    apiGroup = script().mapIdToAppName(query.appId);
  } catch {
    apiGroup = "";
  }

  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", query.name), Transform.inlineAssign("verb", query.verb)],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("api_group", apiGroup));

  const headers = mapperGet("context.headers", data);
  if (!phpEmpty(headers) && !phpEmpty(mapperGet("context.headers.value", data))) {
    blocks.push(Transform.convertAssignmentValue(headers, "headers"));
  }

  const token = mapperGet("context.token", data);
  if (!phpEmpty(token)) {
    const auth: KindNode[] = [Transform.inlineAssign("token", token)];

    if (!phpEmpty(mapperGet("context.token_ignore_expiration", data))) {
      auth.push(Transform.inlineAssign("ignore_expiration", true, "static:bool"));
    }

    blocks.push(Transform.inlineAssign("auth", auth, "static:object"));
  }

  if (!phpEmpty(data.input)) blocks.push(Transform.convertFlexInputToBlock(data.input));

  return ret;
}
