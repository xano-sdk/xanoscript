/** Port of redacted. */
import { script } from "../../engine/context.js";
import { phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:error_trigger";

export function ErrorTrigger(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [Transform.inlineAssign("name", phpEmpty(data.name) ? "error_trigger" : data.name)],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  if (phpEmpty(data.active)) blocks.push(Transform.inlineAssign("active", data.active, "static:bool"));

  // The input schema for error triggers is runtime-fixed — always render the
  // canonical shape rather than trusting whatever's persisted on the row,
  // which may be stale relative to the current schema version.
  const input = buildErrorTriggerInputSchema();
  blocks.push(Transform.convertToKind("schema:input", input));

  blocks.push(Transform.convertToKind("schema:stack", data.run ?? []));

  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  Transform.onSchemaRequestHistory(data, ret);

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  return ret;
}

/** Port of redacted — the runtime-fixed error-trigger input. */
function buildErrorTriggerInputSchema(): Array<Record<string, unknown>> {
  const leaf = (name: string, type: string, description = "", nullable = false, values: string[] = []): Record<string, unknown> => ({
    _xsid: "",
    name,
    type,
    description,
    nullable,
    default: "",
    merge: false,
    hidden: [],
    override: [],
    customize: "",
    required: false,
    values,
    mode: "",
    format: "",
    sensitive: false,
    access: "public",
    is_settings_registry: false,
    children: [],
    list: { min: "", max: "" },
    vector: { size: 3 },
    style: { type: "single" },
    methods: [],
    market_item: { id: 0, version: 0, guid: "" },
  });
  const obj = (name: string, description: string, children: Array<Record<string, unknown>>, nullable = false): Record<string, unknown> => {
    const node = leaf(name, "obj", description, nullable);
    node.children = children;
    return node;
  };

  return [
    leaf(
      "event",
      "enum",
      'Which event fired the trigger. "new" fires on first capture and on every snapshot re-capture for non-ignored signatures (rate-limited by the ~5min snapshot dedup window). "regression" fires when a previously-fixed signature re-occurs (the fix didn\'t hold, or the same bug regressed back). "fixed" fires when a user marks a signature as fixed.',
      false,
      ["new", "regression", "fixed"],
    ),
    leaf("id", "int", "The error signature row id. Use to build deep links into the error-logs UI."),
    leaf("signature", "text", "Stable hash that identifies this error signature."),
    obj("error", "Error code and message captured from the failing run.", [
      leaf("code", "text", "Machine-readable error code."),
      leaf("message", "text", "Human-readable error message."),
    ]),
    obj(
      "caller",
      "Where the error originated. Null on 'fixed' events.",
      [
        leaf("type", "text", "Caller kind (api, function, task, middleware, trigger, unknown)."),
        leaf("id", "int", "Caller object id."),
        leaf("name", "text", "Caller object name.", true),
      ],
      true,
    ),
    obj(
      "statement",
      "Failing statement. Null on 'fixed' events.",
      [leaf("name", "text", "Statement name."), leaf("xsid", "text", "Statement xsid within the function stack.")],
      true,
    ),
    obj(
      "actor",
      "User who marked the error as fixed. Populated only for 'fixed' events.",
      [leaf("id", "int", "User id."), leaf("name", "text", "User name.", true)],
      true,
    ),
    obj("count", "Occurrence counts for this signature.", [
      leaf("total", "int", "Total occurrences since first seen."),
      leaf("last_hour", "int", "Occurrences in the last hour."),
    ]),
    leaf("first_seen", "text", "ISO-8601 UTC timestamp of the first occurrence."),
    leaf("last_seen", "text", "ISO-8601 UTC timestamp of the most recent occurrence."),
    leaf("fixed_at", "text", "ISO-8601 UTC timestamp the error was marked fixed. Null otherwise.", true),
  ];
}
