/** Port of redacted. */
import { phpEmpty, strval } from "../../engine/php.js";
import { Transform, mapperGet, type KindNode } from "../transform.js";

export const KIND = "schema:db.direct_query";

/**
 * The PHP class is parameterised by its constructor (`$kind`,
 * `$connection_string`) and subclassed by the five `External*DirectQuery`
 * transforms, which only pass their own kind and `connection_string: true`.
 * This is the shared `encode()` those ports call.
 */
export function directQueryEncode(data: Record<string, unknown>, kind: string, connectionString: boolean): KindNode {
  const ret: KindNode = { kind, args: [], blocks: [] };
  const blocks = ret.blocks as KindNode[];

  blocks.push(Transform.inlineAssign("sql", mapperGet("context.code", data, "")));

  const parser = mapperGet("context.parser", data, "prepared");

  if (parser !== "prepared") {
    blocks.push(Transform.inlineAssign("parser", parser));
  }

  blocks.push(Transform.inlineAssign("response_type", mapperGet("context.response_type", data, "list")));

  if (connectionString) {
    let connection = mapperGet("context.connection_string_flex.value", data, "");
    if (!phpEmpty(connection)) {
      blocks.push(Transform.convertAssignmentValue(mapperGet("context.connection_string_flex", data), "connection_string"));
    } else {
      connection = mapperGet("context.connection_string", data, "");

      blocks.push(
        Transform.inlineAssign(
          "connection_string",
          connection,
          !phpEmpty(connection) && !strval(connection).includes("://") ? "assign:env" : "static:text",
        ),
      );
    }
  }

  if (parser === "prepared") {
    const args = mapperGet("context.arg", data, []);
    if (!phpEmpty(args)) {
      blocks.push(...Transform.convertRepeatingAssignmentValue(args, "arg"));
    }
  }

  return ret;
}

export function DirectQuery(data: Record<string, unknown>): KindNode {
  return directQueryEncode(data, KIND, false);
}
