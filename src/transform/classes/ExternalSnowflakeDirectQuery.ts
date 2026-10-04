/** Port of redacted (inherited from `DirectQuery` with this kind and `connection_string: true`). */
import type { KindNode } from "../transform.js";
import { directQueryEncode } from "./DirectQuery.js";

export const KIND = "schema:db.external.snowflake.direct_query";

export function ExternalSnowflakeDirectQuery(data: Record<string, unknown>): KindNode {
  return directQueryEncode(data, KIND, true);
}
