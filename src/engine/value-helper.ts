/** Port of redacted: scalar-shape predicates. */
import { Parser } from "./parser.js";
import { ctypeDigit, floatToString, isFloat, isInt, isPhpObject } from "./php.js";

const TIMESTAMP_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\s(?:[01]\d|2[0-3]):(?:[0-5]\d):(?:[0-5]\d)(?:[+-]\d{4})$/;

export const ValueHelper = {
  isTimestamp(str: unknown): boolean {
    if (typeof str !== "string") return false;
    if (str === "now") return true;
    const year = str.substring(0, 4);
    if (!ctypeDigit(year)) return false;
    return TIMESTAMP_RE.test(str);
  },

  isVarName(str: unknown, complex = false): boolean {
    if (typeof str !== "string") return false;
    if (str === "$$") return true;
    if (!str.startsWith("$")) return false;
    try {
      const parts = Parser.splitVar(str, true, true);
      if (!complex) {
        for (const part of parts) {
          if (part.startsWith("[")) return false;
        }
      }
    } catch {
      return false;
    }
    return true;
  },

  isTableName(str: unknown): boolean {
    if (typeof str !== "string") return false;
    return /^\$[0-9a-zA-Z_][a-zA-Z0-9_.$]*$/.test(str);
  },

  isBool(str: unknown): boolean {
    return str === "true" || str === "false";
  },

  isInt(str: unknown): boolean {
    if (isInt(str) || isFloat(str)) str = floatToString(str as number);
    if (typeof str !== "string") return false;
    return /^[-]?(0|[1-9][0-9]*)$/.test(str);
  },

  isDecimal(str: unknown): boolean {
    if (isFloat(str)) str = floatToString(str as number);
    if (typeof str !== "string") return false;
    return /^[-]?(0|[1-9][0-9]*)\.[0-9]+$/.test(str);
  },

  isArray(str: unknown): boolean {
    return (Array.isArray(str) && str.length === 0) || str === "[]";
  },

  isObject(str: unknown): boolean {
    return isPhpObject(str) || str === "{}";
  },
};
