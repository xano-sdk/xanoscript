/** Port of the engine's schema-key lookups (element / value / has-element / is-list) the kind parsers use. */
import { isPhpArray, isScalar } from "./php.js";
import { parseAssignment, type ParsedParam } from "./xs-param.js";

export interface SchemaElement {
  schema: ParsedParam;
  key: string;
  value: unknown;
}

function isPunct(key: string): boolean {
  return key.length > 0 && /^[!-/:-@[-`{-~]+$/.test(key);
}

function convertToActualPath(el: string, schema: unknown): string {
  const parts = el.split(".");
  const at = isPhpArray(schema) ? (schema as Record<string, unknown>)["@"] : undefined;
  if (Array.isArray(at) && at.includes(parts[0])) {
    const first = parts.shift()!;
    parts.unshift("value");
    parts.unshift(first);
  }
  return parts.join(".");
}

/** Locate `index` (dotted) in a schema map keyed by decorated names (`name?=x: type`). */
export function xsGetElement(index: string, schemaIn: unknown): SchemaElement {
  index = convertToActualPath(index, schemaIn);
  const parts = index.split(".");
  let schema: unknown = schemaIn;
  let a: ParsedParam | null = null;
  let foundKey = "";

  while (parts.length) {
    const part = parts.shift()!;
    if (!isPhpArray(schema)) throw new Error(`Unable to locate element1: ${index}`);
    let matched = false;
    for (const [key, val] of Object.entries(schema as Record<string, unknown>)) {
      if (isPunct(key)) continue;
      const parsed = parseAssignment(key);
      if (parsed.name === part) {
        a = parsed;
        foundKey = key;
        schema = val;
        if (isScalar(schema) && typeof schema === "string" && schema.startsWith("blob")) parts.length = 0;
        matched = true;
        break;
      }
    }
    if (!matched) throw new Error(`Unable to locate element: ${index}`);
  }

  return { schema: a!, key: foundKey, value: schema };
}

export function xsGetElementValue(index: string, schema: unknown, fallback: unknown = null): unknown {
  try {
    return xsGetElement(index, schema).value;
  } catch {
    return fallback;
  }
}

export function xsHasElement(index: string, schema: unknown): boolean {
  try {
    xsGetElement(index, schema);
    return true;
  } catch {
    return false;
  }
}

/** the engine's `isList($wrap)`. */
export function xsIsList(wrap: ParsedParam["wrap"] | Record<string, unknown>): boolean {
  if (!wrap || typeof wrap !== "object") return false;
  if (!Array.isArray(wrap)) return Boolean((wrap as Record<string, unknown>).list);
  if (wrap.length !== 1) return false;
  return wrap[0]!.type === "list";
}
