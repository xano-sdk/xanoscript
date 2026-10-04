/** Port of redacted: parse and canonically re-render `{...}` literals. */
import { Assign, type AssignResult } from "./assign-parser.js";
import { Parser } from "./parser.js";
import { ltrim, mbSubstr, phpEmpty, trim } from "./php.js";
import { ScriptHelper } from "./script-helper.js";
import { normalizeIndent } from "./system.js";
import { Transform } from "../transform/transform.js";

export const StaticObject = {
  parse(strIn: string): AssignResult[] {
    const schemas: AssignResult[] = [];
    let str = strIn;
    while (true) {
      str = ltrim(str);
      if (phpEmpty(str)) break;
      const ret = Assign.parse(str, Assign.MODE_LEFT, true, ":", false);
      schemas.push(ret.result);
      str = mbSubstr(str, ret.cnt);
      str = ltrim(str);
      if (str.startsWith(",")) str = mbSubstr(str, 1);
    }
    return schemas;
  },

  isSimple(schemas: unknown): boolean {
    if (!Array.isArray(schemas)) return false;
    for (const schema of schemas as Array<Record<string, unknown>>) {
      if (schema.name === undefined || schema.name === null) return false;
      if (ScriptHelper.doesObjectKeyNeedWrap(String(schema.name))) return false;
    }
    return true;
  },

  isAllStatic(values: Array<Record<string, unknown>>): boolean {
    for (const value of values) {
      switch (value.kind) {
        case "assign:env":
        case "assign:var":
        case "assign:input":
        case "assign:output":
        case "assign:text":
        case "assign:timestamp":
        case "assign:int":
        case "assign:decimal":
        case "assign:null":
        case "assign:bool":
          if (!phpEmpty(value.filter)) return false;
          continue;
        case "static:timestamp":
        case "static:timestamp[]":
        case "static:text":
        case "static:text[]":
        case "static:int":
        case "static:int[]":
        case "static:decimal":
        case "static:decimal[]":
        case "static:bool":
        case "static:bool[]":
        case "static:null":
          continue;
        case "static:object":
          if (!StaticObject.isAllStatic(value.value as Array<Record<string, unknown>>)) return false;
          continue;
        case "static:object[]":
          for (const value2 of value.value as Array<Array<Record<string, unknown>>>) {
            if (!StaticObject.isAllStatic(value2)) return false;
          }
          continue;
        case "assign:expr":
          return false;
        case "static:array":
          return true;
      }
      return false;
    }
    return true;
  },

  reformat(retIn: string): string {
    let ret = retIn;
    let str = mbSubstr(ret, 1, -1);
    str = trim(str);
    if (!phpEmpty(str)) {
      const oldMultiline = Parser.setMultilineTicks(false);
      try {
        const objectRet = StaticObject.parse(str);
        if (StaticObject.isSimple(objectRet)) {
          ret = Transform.renderStaticObject(objectRet as unknown as Array<Record<string, unknown>>);
          ret = normalizeIndent(ret, true);
        }
      } catch {
        // ignore
      } finally {
        Parser.setMultilineTicks(oldMultiline);
      }
    }
    return ret;
  },
};
