/** Port of redacted: parse and canonically re-render `[...]` literals. */
import { Assign } from "./assign-parser.js";
import { filterBoolean } from "./input-filters.js";
import { StdClass, arrayUnique, isPhpObject, ltrim, mbSubstr, phpEmpty, trim } from "./php.js";
import { ScriptHelper } from "./script-helper.js";
import { StaticObject } from "./static-object.js";
import { indent, normalizeIndent } from "./system.js";
import { RawValue } from "./values.js";

export const StaticArray = {
  parse(strIn: string): { kind: string; value: unknown } {
    let lastKind: string | null = null;
    const values: unknown[] = [];
    const origStr = strIn;
    const kinds: string[] = [];
    let str = strIn;

    while (true) {
      str = ltrim(str);
      if (phpEmpty(str)) break;

      const ret = Assign.parse(str, Assign.MODE_RIGHT);

      if (ret.result.kind === "static:object") {
        if (!StaticObject.isAllStatic(ret.result.value as any[])) ret.result.kind = "assign:expr";
      }

      kinds.push(ret.result.kind);
      if (lastKind === null) lastKind = ret.result.kind;

      switch (ret.result.kind) {
        case "static:object":
          if (phpEmpty(ret.result.value)) ret.result.value = new StdClass();
          break;
        case "assign:null":
          ret.result.value = null;
          break;
      }

      values.push(ret.result.value);

      str = mbSubstr(str, ret.cnt);
      str = ltrim(str);
      if (str.startsWith(",")) str = mbSubstr(str, 1);
    }

    for (const kind of ["assign:input", "assign:var", "assign:env", "assign:expr"]) {
      if (kinds.includes(kind)) return { kind: "assign:expr", value: "[" + origStr + "]" };
    }

    if (arrayUnique(kinds).length > 1) {
      let foundKind = "static:json";
      for (const kind of kinds) {
        if (kind.startsWith("assign:") && kind !== "assign:null") {
          foundKind = "assign:expr";
          break;
        }
      }
      return { kind: foundKind, value: values };
    }

    let final = lastKind ?? "";
    if (final.includes("[]") || final === "static:json") final = "static:json";
    else final += "[]";

    return { kind: final, value: values };
  },

  parseForReformat(strIn: string, _strict = false): { kind: string; value: unknown[]; newline: boolean } {
    let lastKind: string | null = null;
    const values: unknown[] = [];
    const kinds: string[] = [];
    let newline = false;
    let str = strIn;

    while (true) {
      str = ltrim(str);
      if (phpEmpty(str)) break;

      const ret = Assign.parse(str, Assign.MODE_RIGHT);
      if (lastKind === null) lastKind = ret.result.kind;

      let value: unknown;
      if (ret.result.kind === "static:object") {
        value = new RawValue(ret.result.raw as string);
      } else {
        value = ret.result.value;
      }

      const [rendered, wrap] = StaticArray.renderScalarValue(ret.result);

      if (!phpEmpty(ret.result.filter)) {
        const base = ret.result.kind === "static:object" ? (ret.result.raw as string) : rendered;
        value = new RawValue(String(base) + "|" + ret.result.filter);
      } else {
        if (ret.result.kind === "assign:expr") value = new RawValue(String(value));
      }

      const rawValue = value instanceof RawValue ? value.getValue() : value;
      if (typeof rawValue === "string" && rawValue.includes("\n")) newline = true;

      if (!(value instanceof RawValue)) {
        kinds.push(ret.result.kind);
        value = wrap ? new RawValue(String(rendered)) : rendered;
      }

      values.push(value);

      str = mbSubstr(str, ret.cnt);
      str = ltrim(str);
      if (str.startsWith(",")) str = mbSubstr(str, 1);
    }

    return { kind: (lastKind ?? "") + "[]", value: values, newline };
  },

  renderScalarValue(result: { kind: string; value: unknown; raw?: string }): [unknown, boolean] {
    const value = result.value;
    switch (result.kind) {
      case "static:int":
      case "static:decimal":
      case "static:null":
      case "assign:null":
        return [value, true];
      case "static:bool":
        return [filterBoolean(value) ? "true" : "false", true];
      case "assign:var":
        return [ScriptHelper.renderVarName(String(value)), true];
      case "assign:input":
        return ["$input." + String(value), true];
      case "assign:env":
        return ["$env." + String(value), true];
      default:
        return result.raw ? [StaticArray.reformat(result.raw), true] : [value, false];
    }
  },

  isSimple(items: unknown): boolean {
    if (!Array.isArray(items) && !(items !== null && typeof items === "object" && !isPhpObject(items))) return false;
    const list = Array.isArray(items) ? items : Object.values(items as object);
    if (list.length === 0) return true;
    if (!Array.isArray(items)) return StaticObject.isSimple(items);

    for (let item of list) {
      if (item instanceof RawValue) {
        item = item.getValue();
        if (typeof item === "string" && item.includes("\n")) return false;
      }
      if (isPhpObject(item)) return false;
      if (Array.isArray(item) || (item !== null && typeof item === "object")) {
        if (!StaticArray.isSimple(item)) return false;
      }
    }
    return true;
  },

  reformat(retIn: string): string {
    let ret = retIn;
    let str = mbSubstr(ret, 1, -1);
    str = trim(str);
    if (!phpEmpty(str)) {
      try {
        const arrayRet = StaticArray.parseForReformat(str, true);
        if (!arrayRet.newline) {
          ret = String(ScriptHelper.wrap(arrayRet.value, true, "assign:var"));
        } else {
          let lines: string[] | null = [];
          for (let value of arrayRet.value) {
            if (value instanceof RawValue) value = value.getValue();
            const s = String(value);
            if (s.includes("\n")) {
              lines = null;
              break;
            }
            lines.push(s);
          }

          if (lines && lines.length) {
            ret = "[\n" + lines.join("\n") + "\n]";
          } else {
            ret = normalizeIndent(ret, true);
            ret = indent(ret, 2, true);
            ret = indent(ret, "]", true);
          }
        }
      } catch {
        // ignore
      }
    }
    return ret;
  },
};
