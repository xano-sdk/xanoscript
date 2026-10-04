/**
 * Emulation of `$app->XS->parse($schema, $data)` for the schemas the kind
 * parsers hand it. The engine validates every kind-tree node through its
 * input-schema engine, which also COERCES values (text is trimmed, "5" becomes
 * 5, "true" becomes true, defaults are filled in), so the port must apply the
 * same coercions or the rendered bytes drift.
 */
import { filterBoolean, filterDecimal, filterEnum, filterInteger, filterJson, filterText, InputError } from "./input-filters.js";
import { StdClass, ctypeDigit, isAssoc, isPhpArray, isPhpObject, trim } from "./php.js";
import { parseAssignment } from "./xs-param.js";

export type XsSchema = Record<string, unknown>;

export interface XsParseOptions {
  /** Parser for `script_block` typed values (a kind-tree node → KindValue). */
  block?: (value: unknown) => unknown;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function formatUtc(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`;
}

/** The engine's timestamp input filter: normalize to `Y-m-d H:i:sO` in UTC. */
export function filterTimestamp(value: unknown): string | null {
  if (value === "" || value === null || value === undefined) return null;
  if (value === "now") return formatUtc(Math.floor(Date.now() / 1000));

  const v = filterText(value);
  if (ctypeDigit(trim(v, "-"))) return formatUtc(parseInt(v, 10));

  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})$/.exec(v);
  if (m) {
    const epoch = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) / 1000;
    const offset = (+m[8]! * 60 + +m[9]!) * 60 * (m[7] === "-" ? -1 : 1);
    return formatUtc(epoch - offset);
  }

  const parsed = Date.parse(v);
  if (Number.isNaN(parsed)) throw new InputError("Invalid timestamp format.");
  return formatUtc(Math.floor(parsed / 1000));
}

function coerceScalar(type: string, value: unknown, opts: XsParseOptions): unknown {
  if (type.startsWith("enum|values(")) {
    const json = type.substring("enum|values(".length, type.length - 1);
    return filterEnum(value, JSON.parse(json) as unknown[]);
  }
  switch (type) {
    case "text":
      return filterText(value);
    case "int":
      return filterInteger(value);
    case "decimal":
      return filterDecimal(value);
    case "bool":
      return filterBoolean(value);
    case "json":
      return filterJson(value);
    case "timestamp":
      return filterTimestamp(value);
    case "script_block":
      if (!opts.block) throw new Error("script_block parser missing");
      return opts.block(value);
    default:
      // any, enum (no values), addon, mvp_* structured types and unknown names pass through.
      return value;
  }
}

/** The engine's list-input shape handling: a JSON-looking string decodes, a scalar wraps. */
function toList(value: unknown): unknown[] {
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [value];
    }
  }
  if (Array.isArray(value)) return value;
  if (value instanceof StdClass) return [];
  if (isAssoc(value)) return Object.values(value);
  return [value];
}

function coerce(type: unknown, value: unknown, listDepth: number, nullable: boolean, opts: XsParseOptions): unknown {
  if (listDepth > 0) {
    const list = toList(value);
    return list.map((v) => {
      if (v === null && nullable) return null;
      return coerce(type, v, listDepth - 1, nullable, opts);
    });
  }
  if (value === null || value === undefined) {
    if (nullable) return null;
  }
  if (typeof type === "string") return coerceScalar(type, value, opts);
  if (isAssoc(type)) {
    if (value === null || value === undefined) return nullable ? null : xsParse(type as XsSchema, {}, opts);
    return xsParse(type as XsSchema, value, opts);
  }
  return value;
}

/**
 * Parse `data` against `schema`. Keys are decorated (`name?=default: type`);
 * the result contains only schema keys, defaults applied, values coerced.
 */
export function xsParse(schema: XsSchema, data: unknown, opts: XsParseOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src: Record<string, unknown> = isPhpArray(data) && !Array.isArray(data) ? (data as Record<string, unknown>) : isPhpObject(data) && !(data instanceof StdClass) ? (data as Record<string, unknown>) : {};

  for (const [key, type] of Object.entries(schema)) {
    if (key.startsWith("@")) continue;
    const p = parseAssignment(key, false);
    const name = p.name;
    const listDepth = p.wrap ? p.wrap.filter((w) => w.type === "list").length : 0;

    let value: unknown;
    let present = Object.prototype.hasOwnProperty.call(src, name);
    if (present) {
      value = src[name];
    } else if (p.hasDefault) {
      value = p.default;
      present = true;
    } else if (!p.required) {
      continue;
    } else {
      throw new InputError(`Missing param: ${name}`);
    }

    if (value === null && !p.nullable && !present) continue;
    out[name] = coerce(type, value, listDepth, p.nullable, opts);
  }
  return out;
}
