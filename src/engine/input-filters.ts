/**
 * The engine's input filters the kind parsers coerce values through
 * (`$app->XS->parse($schema, $data)` with `text`, `int`, `bool`, …).
 * Each mirrors the corresponding redacted.
 */
import { floatval, intval, isNumeric, isScalar, mapperEmpty, phpEmpty, strval, trim } from "./php.js";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function filterBoolean(value: unknown): boolean {
  if (isScalar(value)) {
    const v = typeof value === "string" ? value.toLowerCase() : value;
    if (v === 1 || v === "1" || v === true || v === "true" || v === "yes" || v === "on") return true;
    if (v === "" || v === 0 || v === "0" || v === false || v === "false" || v === "no" || v === "off") return false;
  }
  throw new InputError("Invalid boolean input.");
}

export function filterInteger(value: unknown): number | bigint {
  if (mapperEmpty(value)) value = 0;
  if (!isScalar(value)) throw new InputError("Integer filter requires a scalar value.");
  if (!isNumeric(value) && typeof value !== "boolean") throw new InputError("Value is not a valid integer.");
  return intval(value);
}

export function filterDecimal(value: unknown): number {
  if (mapperEmpty(value)) value = 0;
  if (!isScalar(value)) throw new InputError("Decimal filter requires a scalar value.");
  if (typeof value !== "number" && !isNumeric(value) && typeof value !== "boolean") {
    throw new InputError("Input is not a valid decimal number.");
  }
  return floatval(value);
}

/** The engine's text filter as the kind parsers see it: no trimming (the goldens keep surrounding whitespace), bools as "true"/"false". */
export function filterText(value: unknown, opts: { trim?: boolean } = {}): string {
  if (!isScalar(value)) {
    if (mapperEmpty(value)) value = "";
    else throw new InputError("Text filter requires an integer, float, string or boolean value.");
  }
  let v: string;
  if (typeof value === "boolean") v = value ? "true" : "false";
  else v = strval(value);
  if (opts.trim === true) v = trim(v);
  return v;
}

export function filterEnum(value: unknown, values: unknown[]): unknown {
  if (!isScalar(value)) throw new InputError("Enum filter requires a scalar value.");
  if (values.length === 0) return value;
  const idx = values.findIndex((v) => v === value || (typeof v === "string" && typeof value !== "string" && v === strval(value)) || (typeof value === "string" && typeof v !== "string" && strval(v) === value));
  if (idx === -1) throw new InputError(`Input "${strval(value)}" is not one of the allowable values.`);
  return values[idx];
}

/** The engine's json filter passes a non-string value through; a string is decoded when it parses. */
export function filterJson(value: unknown): unknown {
  if (typeof value === "string") {
    if (phpEmpty(value)) return [];
    try {
      const decoded = JSON.parse(value);
      if (decoded !== null && typeof decoded !== "object") return value;
      return decoded ?? value;
    } catch {
      return value;
    }
  }
  return value;
}
