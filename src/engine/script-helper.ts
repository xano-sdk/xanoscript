/**
 * Port of redacted: the scalar/object quoting rules and the
 * inline value renderer every `key = value` line goes through.
 */
import { Assign } from "./assign-parser.js";
import { parseGroup } from "./group-parser.js";
import { Parser } from "./parser.js";
import {
  StdClass,
  addslashes,
  ctypeDigit,
  floatToString,
  isFloat,
  isInt,
  isNumeric,
  isPhpArray,
  isPhpObject,
  isScalar,
  phpEmpty,
  phpJsonEncode,
  strlen,
  strRepeat,
  strval,
  trim,
} from "./php.js";
import { renderState } from "./state.js";
import { StaticArray } from "./static-array.js";
import { StaticObject } from "./static-object.js";
import { indent } from "./system.js";
import { ValueHelper } from "./value-helper.js";
import { MultiLineValue, RawValue, TaggedValue } from "./values.js";
import { Transform } from "../transform/transform.js";
import type { KindValue } from "./kind-value.js";

const INDENT = "  ";

function isWrapperObject(v: unknown): boolean {
  return v instanceof TaggedValue || v instanceof RawValue || v instanceof MultiLineValue;
}

export const ScriptHelper = {
  isVerbose(): boolean {
    return renderState.verbose;
  },

  shouldBeInline(value: unknown): boolean {
    if (isPhpArray(value)) {
      for (let item of Object.values(value as object)) {
        if (item instanceof RawValue) item = item.getValue();
        if (typeof item === "string" && item.includes("\n")) return false;
      }
    }

    const ret = phpJsonEncode(value);
    for (const findMe of ["```", '"""', "'''"]) {
      if (ret.includes(addslashes(findMe))) return false;
    }
    return strlen(ret) < 64;
  },

  wrap(valueIn: unknown, strict = true, type: unknown = null, mode = "scalar", level = 1, wrapKeys = true): string | MultiLineValue {
    let value = valueIn;

    if ((isPhpObject(value) && !isWrapperObject(value)) || (Array.isArray(type) && type.length === 0)) {
      if (value instanceof StdClass) value = {};
      else if (!isPhpArray(value)) value = [value];
      if (phpEmpty(value)) {
        if (Array.isArray(type)) {
          if (mode === "list") return "[]";
        }
        return "{}";
      }
    }

    if (isPhpArray(value)) {
      if (Array.isArray(value)) {
        const inline = ScriptHelper.shouldBeInline(value);
        renderState.index++;
        const parts: string[] = [];
        for (let k = 0; k < value.length; k++) {
          const key = inline ? "" : strRepeat(INDENT, renderState.index);
          const childType = Array.isArray(type) ? (type[k] ?? null) : null;
          parts.push(key + String(ScriptHelper.wrap(value[k], strict, childType, mode)));
        }
        renderState.index--;
        if (inline) return "[" + parts.join(", ") + "]";
        return "[\n" + parts.join("\n") + "\n" + strRepeat(INDENT, renderState.index) + "]";
      }

      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      let max = 0;
      const wrappedKeys: Record<string, string> = {};
      for (const k of Object.keys(obj)) {
        const key = wrapKeys ? ScriptHelper.wrapObjectKey(k) : k;
        wrappedKeys[k] = key;
        max = Math.max(max, strlen(key));
      }

      const inline = ScriptHelper.shouldBeInline(value);
      renderState.index++;

      const types: Record<string, unknown> = {};
      if (Array.isArray(type)) {
        for (let k = 0; k < type.length; k++) {
          let v: unknown = type[k];
          let key: string = String(k);
          if (v !== null && typeof v === "object" && typeof (v as KindValue).getKind === "function") {
            key = String((v as KindValue).getName());
            v = (v as KindValue).getKind();
          }
          types[key] = v;
        }
      }

      for (const k of Object.keys(obj)) {
        let key = wrappedKeys[k]!;
        if (!inline) {
          key = strRepeat(INDENT, renderState.index) + key + strRepeat(" ", max - strlen(key));
        }
        parts.push(key + ": " + String(ScriptHelper.wrap(obj[k], strict, types[k] ?? null, mode, level + 1)));
      }
      renderState.index--;

      if (inline) return "{" + parts.join(", ") + "}";
      return "{\n" + parts.join("\n") + "\n" + strRepeat(INDENT, renderState.index) + "}";
    }

    switch (mode) {
      case "text":
        return Parser.wrapText(value);
      case "raw":
        if (value instanceof MultiLineValue) return value.indent(2 * level);
        return strval(value instanceof RawValue ? value.getValue() : value);
      default:
        return ScriptHelper.wrapScalar(value, strict, type, level);
    }
  },

  wrapExpression(valueIn: unknown): string | MultiLineValue {
    let value: string = isPhpArray(valueIn) ? String(ScriptHelper.wrap(valueIn)) : strval(valueIn);
    let ret = trim(value);

    if (Parser.isMultilineTicks(ret)) {
      ret = value.replace(/^[ \t\n\r\0\v]+/, "");
      if (!ret.startsWith("{") && !ret.startsWith("[")) {
        return new MultiLineValue(value, "const:expr", 2);
      }
      try {
        const result = parseGroup(value);
        if (trim(result) !== trim(value)) {
          const post = value.substring(result.length);
          if (Parser.isMultilineTicks(post)) return new MultiLineValue(value, "const:expr", 2);
        }
      } catch {
        return new MultiLineValue(value, "const:expr", 2);
      }
      value = indent(ret, ["}", "]"]);
    }
    return trim(value);
  },

  doesObjectKeyNeedWrap(key: string): boolean {
    return !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(key);
  },

  wrapObjectKey(keyIn: string): string {
    const key = strval(keyIn);
    if (key.startsWith("!")) {
      const tmp = key.substring(1);
      if (Parser.isWrappedInQuotes(tmp)) {
        try {
          let ret = JSON.parse(tmp);
          if (typeof ret !== "string") throw new Error("not a string");
          if (ScriptHelper.doesObjectKeyNeedWrap(ret)) ret = tmp;
          return "!" + ret;
        } catch {
          // fall through
        }
      }
    }
    if (ScriptHelper.doesObjectKeyNeedWrap(key)) return Parser.wrapText(key);
    return key;
  },

  wrapScalar(value: unknown, _strict = true, type: unknown = null, level = 1): string | MultiLineValue {
    if (value instanceof TaggedValue) {
      let tagValue = strval(value.getValue());
      if (tagValue === "") tagValue = '""';
      return `!${value.getTag()} ${tagValue}`;
    }
    if (value instanceof RawValue) return value.getValue();
    if (value === null || value === undefined || type === "null") return "null";
    if (value === "null") return '"null"';
    if (!isScalar(value)) throw new Error("Input is not scalar");
    if (typeof value === "bigint") return value.toString();
    if (isInt(value) || isFloat(value)) return floatToString(value as number);
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === "true") return '"true"';
    if (value === "false") return '"false"';
    if (isNumeric(value)) return '"' + value + '"';
    if (Parser.isMultilineQuotes(value)) return new MultiLineValue(value, typeof type === "string" ? type : "const", 2 * level);

    switch (type) {
      case "assign:expr":
        return ScriptHelper.wrapExpression(value);
      case "static:timestamp":
        if (ValueHelper.isTimestamp(value)) return value;
        break;
    }
    return Parser.wrapText(value);
  },

  renderInlineType(type: string, value: unknown): string | MultiLineValue | null {
    switch (type) {
      case "bool":
        if (typeof value === "boolean") return value ? "true" : "false";
        if (value === "true" || value === "false") return value;
        break;
      case "int":
        if (isInt(value)) return strval(value);
        if (ctypeDigit(value)) return strval(value);
        break;
      case "decimal":
        if (isFloat(value)) return floatToString(value);
        if (isNumeric(value)) return strval(value);
        break;
      case "null":
        if (value === null || value === undefined) return "null";
        if (value === "null") return value;
        break;
      case "text":
      case "text[]":
      case "bool[]":
      case "int[]":
      case "decimal[]":
        return ScriptHelper.wrap(value);
      case "timestamp":
        if (ValueHelper.isTimestamp(value)) return value as string;
        break;
      case "expr":
        return ScriptHelper.wrapExpression(value);
      case "output":
      case "error":
      case "auth":
      case "input":
      case "env":
      case "toolset":
        return Transform.wrapPrefix(value, "$" + type);
      case "response":
        return "$" + Transform.setPrefix("response", strval(value));
      case "var":
        return ScriptHelper.renderVarName(strval(value));
      case "array":
      case "object":
        return ScriptHelper.wrap(value);
      default:
        return ScriptHelper.wrap(value);
    }
    throw new Error("Invalid type: " + type);
  },

  renderVarName(valueIn: string): string {
    let value = valueIn;
    let parts = value.split(".");
    if (parts[0] === "$this" || parts[0] === "$index") return value;

    value = value.replace(/^\$+/, "");
    parts = value.split(".");
    if (["auth", "input", "env", "response", "output", "var", "db", "error", "toolset", "this", "index"].includes(parts[0]!)) {
      parts.unshift("var");
      value = parts.join(".");
    }
    return "$" + value;
  },

  canRenderMinimal(): boolean {
    return !renderState.verbose;
  },

  renderFilters(filter: string, pad = 2, _empty = true): string {
    const methods = Parser.splitPipe(filter);
    for (let m = 0; m < methods.length; m++) {
      const args = Parser.splitColon(methods[m]!);
      let render = false;
      for (let a = 0; a < args.length; a++) {
        const arg = args[a]!;
        if (Parser.isWrappedInParentheses(arg)) {
          const tmp = Parser.stripParentheses(arg) as string;
          const filters2 = Parser.splitPipe(tmp);
          const value = filters2.shift() ?? "";
          const joined = filters2.join("|");
          const pk = ScriptHelper.renderFilters(joined, pad + 2);
          if (pk.includes("\n")) {
            args[a] = "(" + value + pk + "\n" + strRepeat(" ", pad) + ")";
            render = true;
          }
        }
      }
      if (render) methods[m] = args.join(":");
    }

    if (strlen(filter) > 32 || methods.length > 2) {
      methods.unshift("");
      return methods.join("\n" + strRepeat(" ", pad) + "|");
    }
    return "|" + filter;
  },

  renderInline(kind: string, type: string, value: unknown, filter: string | null = null, hint: string | null = null): string {
    if (ScriptHelper.canRenderMinimal()) {
      let ret: string | MultiLineValue | null;
      if (kind === "assign:object") ret = ScriptHelper.wrap(value, true, null, "raw");
      else ret = ScriptHelper.renderInlineType(type, value);

      if (ret !== null) {
        if (!phpEmpty(filter)) {
          if (kind === "assign:expr" && !Parser.isWrappedInTicks(ret)) {
            ret = Parser.wrapExpressionText(ret);
          }
          const isMultiline = ret instanceof MultiLineValue;
          let s = String(ret);
          s += ScriptHelper.renderFilters(filter as string, 2, !isMultiline);
          return s;
        }
        if (kind === "assign:expr") {
          if (hint === "assign" && !Parser.isWrappedInTicks(ret)) {
            const s = String(ret);
            if (Assign.needToForceExpression(s) || !Assign.mightBeExpression(s)) {
              ret = Parser.wrapExpressionText(s);
            }
          }
          const tmp = trim(String(ret));
          if (Parser.isWrappedInBrackets(tmp)) ret = StaticArray.reformat(tmp);
          else if (Parser.isWrappedInCurlyBrackets(tmp)) ret = StaticObject.reformat(tmp);
        }
      }
      return String(ret);
    }

    let v: unknown;
    switch (kind) {
      case "assign:bool":
        v = value ? "true" : "false";
        break;
      case "assign:null":
        v = "";
        break;
      case "assign:array":
        v = "[]";
        break;
      case "assign:object":
        v = ScriptHelper.renderInlineObject(value);
        break;
      default:
        v = value;
    }

    let s: string;
    if (v instanceof RawValue) {
      s = v.getValue();
    } else {
      if (!isScalar(v)) v = String(ScriptHelper.wrap(v));
      s = Parser.wrapText(v);
    }

    if (!phpEmpty(filter)) s += "|" + filter;
    if (type === "text") s = Parser.escapeMultiline(s) as string;
    return `!${type} ${s}`;
  },

  renderInlineObject(value: unknown): RawValue | string {
    if (isPhpArray(value) && !phpEmpty(value)) return new RawValue(String(ScriptHelper.wrap(value)));
    return "{}";
  },
};
