/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:query";

export function Query(data: Record<string, unknown>): KindNode {
  try {
    Transform.pushContext(data);
    const ret: KindNode = {
      kind: KIND,
      args: [Transform.inlineAssign("name", data.name ?? ""), Transform.inlineAssign("verb", data.verb ?? "GET")],
      blocks: [],
    };
    const blocks = ret.blocks as KindNode[];

    const apiGroup = script().mapIdToAppName((data.app as Record<string, unknown> | undefined)?.id ?? 0, false);
    if (!phpEmpty(apiGroup)) blocks.push({ name: "api_group", kind: "static:text", value: apiGroup });

    if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

    if (!phpEmpty(data.auth)) {
      let authName: string;
      try {
        authName = script().mapIdToDboName(data.auth);
      } catch {
        authName = "";
      }
      blocks.push(Transform.inlineAssign("auth", authName));
    }

    blocks.push(Transform.convertToKind("schema:input", data.input));
    blocks.push(Transform.convertToKind("schema:stack", data.run));

    if ((data.response_type ?? "") === "stream") {
      blocks.push(Transform.inlineAssign("response_type", "stream"));
    } else {
      blocks.push(Transform.onSchemaResponse(data));
    }

    Transform.createToSchemaTableTags(ret, data.tag ?? []);

    if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

    Transform.onSchemaRequestHistory(data, ret);
    Transform.onSchemaCache(data, ret);
    Transform.onSchemaTesting(data, ret);
    Transform.onSchemaMiddlewareMapping(data, ret);

    if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

    return ret;
  } finally {
    Transform.popContext();
  }
}
