/**
 * Port of redacted (encode half): the `db.query` family —
 * where/join/sort/paging/return/output/addon rendering.
 */
import { script } from "../engine/context.js";
import { entries, isPhpArray, isScalar, looseEquals, mapperEmpty, phpEmpty, strval } from "../engine/php.js";
import { ScriptHelper } from "../engine/script-helper.js";
import { RawValue } from "../engine/values.js";
import { Transform, mapperGet, type KindNode } from "./transform.js";

/** the engine's `normalize($name, lower: false)`: byte-wise non-alphanumerics become `_`. */
export function mvpNormalize(name: string, lower = true): string {
  if (lower) name = name.toLowerCase();
  let out = "";
  for (const byte of Buffer.from(name, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9]/.test(ch)) out += ch;
    else out += "_";
  }
  out = out.replace(/^_+|_+$/g, "");
  while (out.includes("__")) out = out.split("__").join("_");
  return out;
}

export const DB = {
  onSchemaQueryAll(dataIn: Record<string, unknown>): KindNode {
    const data = { ...dataIn };
    const ret: KindNode = { kind: "schema:db.query", args: [], blocks: [] };
    if (!isPhpArray(data.context)) data.context = {};
    const context = data.context as Record<string, unknown>;

    Transform.onAs(data, ret.args as KindNode[]);
    DB.onDbo(mapperGet("context.dbo.id", data), ret.args as KindNode[]);

    const blocks = ret.blocks as KindNode[];
    DB.onDisabled(data.disabled ?? false, blocks);
    DB.onDescription(data.description ?? false, blocks);
    DB.onDocs(data.docs ?? false, blocks);
    DB.onLock(context.lock ?? false, blocks);

    const renameMap = DB.getNormalizedMap(data);

    const MODE = Transform.getPipeMode();
    Transform.setPipeMode(Transform.PIPE_MODE_FILTERS);
    try {
      DB.onBinds(context.bind ?? [], blocks, renameMap);
      DB.onSearch(context.search ?? [], blocks, renameMap);
      DB.onExternalSimpleSearch(context.simpleExternal ?? [], blocks);
      DB.onSort(context.return ?? null, blocks, renameMap);
      DB.onExternalSimpleSort(context.simpleExternal ?? [], blocks);
      DB.onEvals(context.eval ?? [], blocks);
    } finally {
      Transform.setPipeMode(MODE);
    }

    DB.onReturn(context.return ?? null, context.simpleExternal ?? [], blocks);
    DB.onOutput(data.output ?? [], blocks);
    DB.onAddonAssign(data.addon ?? [], blocks);
    return ret;
  },

  getNormalizedMap(data: Record<string, unknown>): Record<string, string> {
    const renameMap: Record<string, string> = {};
    try {
      const as = mapperGet("context.dbo.as", data);
      if (!phpEmpty(as)) {
        const value = script().mapIdToDboName(mapperGet("context.dbo.id", data));
        renameMap[strval(as)] = mvpNormalize(value, false);
      }
    } catch {
      // ignore
    }
    return renameMap;
  },

  onExternalSimpleSearch(data: unknown, blocks: KindNode[]): void {
    const item = mapperGet("search", data, null) as Record<string, unknown> | null;
    if (item && (item.value ?? "") !== "") blocks.push(Transform.convertAssignmentValue(item, "additional_where"));
  },

  onExternalSimpleSort(data: unknown, blocks: KindNode[]): void {
    const item = mapperGet("sort", data, null) as Record<string, unknown> | null;
    if (item && (item.value ?? "") !== "") blocks.push(Transform.convertAssignmentValue(item, "override_sort"));
  },

  onSortImplObject(data: unknown, blocks: KindNode[]): void {
    const sorts: KindNode[] = [];
    for (const sortItem of Object.values((data ?? {}) as object) as Array<Record<string, unknown>>) {
      if (phpEmpty(sortItem.sortBy ?? "")) continue;
      let orderBy = sortItem.orderBy ?? "asc";
      if (!isScalar(orderBy)) orderBy = "asc";
      sorts.push(Transform.inlineAssign(String(sortItem.sortBy), orderBy));
    }
    if (sorts.length) blocks.push(Transform.inlineAssign("sort", sorts, "static:object"));
  },

  onSortImplArray(data: unknown, blocks: KindNode[]): void {
    const sorts: KindNode[][] = [];
    for (const sortItem of Object.values((data ?? {}) as object) as Array<Record<string, unknown>>) {
      if (phpEmpty(sortItem.sortBy ?? "")) continue;
      sorts.push([Transform.inlineAssign("sort", sortItem.sortBy), Transform.inlineAssign("order", sortItem.orderBy ?? "asc")]);
    }
    if (sorts.length) blocks.push(Transform.inlineAssign("sort", sorts, "static:object[]"));
  },

  onDistinct(data: unknown, blocks: KindNode[]): void {
    if (looseEquals(data, "auto")) return;
    blocks.push(Transform.inlineAssign("distinct", data));
  },

  onPaging(data: unknown, override: unknown, blocks: KindNode[], whitelist: string[] | null = null): void {
    const d = (data ?? {}) as Record<string, unknown>;
    if (!(d.enabled ?? false)) return;

    const paging: KindNode[] = [];
    const defaults: Record<string, unknown> = { metadata: true, totals: false, offset: 0 };
    const kinds: Record<string, string> = { page: "static:int", per_page: "static:int", totals: "static:bool", offset: "static:int", metadata: "static:bool" };

    for (const [key, kind] of Object.entries(kinds)) {
      if (Array.isArray(whitelist) && !whitelist.includes(key)) continue;
      if (d[key] === undefined || d[key] === null) continue;

      const overrideItem = (mapperGet(key, override, null) as Record<string, unknown> | null) ?? null;
      if (overrideItem && (overrideItem.value ?? "") !== "") {
        const simple = Transform.createInlineValue(overrideItem);
        if (simple !== null && simple !== "") {
          paging.push(Transform.inlineAssign(key, simple, "assign:expr"));
          continue;
        }
      }

      if (key in defaults && defaults[key] === d[key]) continue;

      let value = d[key];
      let useKind = kind;
      if (kind === "static:int" && typeof value === "string" && !/^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(value) && value !== "") {
        const tag = overrideItem ? (overrideItem.tag ?? null) : null;
        if (tag === "input" || tag === "var") {
          value = Transform.createInlineValue({ tag, value, filters: overrideItem?.filters ?? [] });
        }
        useKind = "assign:expr";
      }
      paging.push(Transform.inlineAssign(key, value, useKind));
    }

    blocks.push(Transform.inlineAssign("paging", paging, "static:object"));
  },

  onSort(data: unknown, blocks: KindNode[], _renameMap: Record<string, string>): void {
    const d = (data ?? {}) as Record<string, unknown>;
    const type = String(d.type ?? "list");
    switch (type) {
      case "count":
      case "exists":
        break;
      case "single":
      case "list":
      case "stream":
      case "aggregate":
        DB.onSortImplObject(mapperGet(`${type}.sort`, d, []), blocks);
        break;
      default:
        throw new Error("Invalid return type.");
    }
  },

  onReturn(data: unknown, override: unknown, blocks: KindNode[]): void {
    const d = (data ?? {}) as Record<string, unknown>;
    const ret: KindNode[] = [];
    const type = String(d.type ?? "list");
    ret.push(Transform.inlineAssign("type", type));

    switch (type) {
      case "count":
      case "exists":
      case "single":
        break;
      case "list":
        DB.onDistinct(mapperGet(`${type}.distinct`, d, "auto"), ret);
        DB.onPaging(mapperGet(`${type}.paging`, d, []), override, ret);
        break;
      case "stream":
        DB.onDistinct(mapperGet(`${type}.distinct`, d, "auto"), ret);
        DB.onPaging(mapperGet(`${type}.paging`, d, []), override, ret, ["page", "per_page"]);
        break;
      case "aggregate": {
        DB.onPaging(mapperGet(`${type}.paging`, d, []), override, ret, ["page", "per_page", "metadata"]);
        let MODE = Transform.getPipeMode();
        Transform.setPipeMode(Transform.PIPE_MODE_FILTERS);
        try {
          DB.onEvals(mapperGet(`${type}.group`, d, []), ret, "group");
        } finally {
          Transform.setPipeMode(MODE);
        }
        MODE = Transform.getPipeMode();
        Transform.setPipeMode(Transform.PIPE_MODE_AGGREGATES);
        try {
          DB.onEvals(mapperGet(`${type}.eval`, d, []), ret);
        } finally {
          Transform.setPipeMode(MODE);
        }
        break;
      }
      default:
        throw new Error("Invalid return type.");
    }

    if (ret.length) blocks.push({ name: "return", kind: "static:object", value: ret });
  },

  onOutput(data: unknown, blocks: KindNode[]): void {
    const d = (data ?? {}) as Record<string, unknown>;
    if (phpEmpty(d.customize)) return;
    blocks.push({ name: "output", kind: "static:text[]", value: DB.flattenOutput(d.items) });
  },

  flattenOutput(output: unknown, prefix: string[] = []): string[] {
    const items: string[] = [];
    for (const item of Object.values((output ?? []) as object) as Array<Record<string, unknown>>) {
      const node = [...prefix, String(item.name)];
      if (phpEmpty(item.children)) items.push(node.join("."));
      else items.push(...DB.flattenOutput(item.children, node));
    }
    return items;
  },

  onInput(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    const obj: KindNode = { kind: "assign:object", name: "input", value: {} };
    for (const v of Object.values(data as object) as Array<Record<string, unknown>>) {
      const raw = Transform.createInlineValue(v, { name: "value", tag: ScriptHelper.isVerbose(), raw: false });
      (obj.value as Record<string, unknown>)[String(v.name)] = new RawValue(raw);
    }
    blocks.push(obj);
  },

  onAddonAssign(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    const items: KindNode[][] = [];
    for (const item of Object.values(data as object) as Array<Record<string, unknown>>) {
      const addon: KindNode[] = [];
      try {
        DB.onAddon(item.id, addon);
        let mapKey = ["offset", "as"].map((key) => strval(item[key] ?? "")).filter((v) => !phpEmpty(v));
        DB.onOutput(item.output ?? [], addon);
        DB.onInput(item.input ?? [], addon);
        DB.onAddonAssign(item.children ?? [], addon);
        let key = mapKey.join(".");
        key = key.split("[]").join("");
        if (!phpEmpty(key)) addon.push(Transform.inlineAssign("as", key));
        items.push(addon);
      } catch {
        // ignore
      }
    }
    if (items.length) blocks.push({ name: "addon", kind: "static:object[]", value: items });
  },

  renameSearch(search: Record<string, unknown>, renameMap: Record<string, string>): Record<string, unknown> {
    const out = { ...search, expression: (Object.values((search.expression ?? []) as object) as Array<Record<string, any>>).map((e) => ({ ...e })) };
    for (const expression of out.expression) {
      if (expression.type === "statement") {
        const statement = { ...expression.statement };
        for (const side of ["left", "right"]) {
          const operand = { ...statement[side] };
          if (operand.tag === "col") {
            const parts = String(operand.operand).split(".");
            if (renameMap[parts[0]!] !== undefined) {
              parts[0] = renameMap[parts[0]!]!;
              operand.operand = parts.join(".");
            }
          }
          statement[side] = operand;
        }
        expression.statement = statement;
      }
    }
    return out;
  },

  onSearch(data: unknown, blocks: KindNode[], renameMap: Record<string, string> = {}): void {
    if (phpEmpty(data)) return;
    const d = data as Record<string, unknown>;
    if (phpEmpty(d.expression ?? [])) return;
    const renamed = DB.renameSearch(d, renameMap);
    const value = Transform.createInlineComparison(renamed, true, false);
    blocks.push({ name: "where", kind: "assign:expr", value });
  },

  onLock(dataIn: unknown, blocks: KindNode[]): void {
    if (phpEmpty(dataIn)) return;
    let data = dataIn as Record<string, unknown>;
    const tag = String(data.tag ?? "");
    const invalidTags = ["action"];
    const isEmptyConst = tag === "const" && phpEmpty(data.value) && phpEmpty(data.filters);
    if (isEmptyConst || invalidTags.includes(tag)) {
      data = { tag: "const:bool", value: "false", filters: [] };
    }
    blocks.push(Transform.convertAssignmentValue(data, "lock"));
  },

  onBinds(data: unknown, blocks: KindNode[], renameMap: Record<string, string> = {}): void {
    if (phpEmpty(data)) return;
    const items: KindNode[] = [];
    for (const item of Object.values(data as object) as Array<Record<string, unknown>>) {
      const as = mapperGet("dbo.as", item, "") as string;
      if (phpEmpty(as)) continue;
      const joinItems: KindNode[] = [];
      DB.onDbo(mapperGet("dbo.id", item), joinItems, "table");
      const joinType = item.join ?? "inner";
      if (joinType !== "inner") joinItems.push(Transform.inlineAssign("type", joinType));
      DB.onSearch(item.search ?? null, joinItems, renameMap);
      items.push({ kind: "static:object", name: as, value: joinItems });
    }
    if (!items.length) return;
    blocks.push({ name: "join", kind: "static:object", value: items });
  },

  onEvals(data: unknown, blocks: KindNode[], name = "eval"): void {
    if (phpEmpty(data)) return;
    const items: KindNode[] = [];
    for (const itemIn of Object.values(data as object) as Array<Record<string, unknown>>) {
      let alias = String(itemIn.as ?? "");
      if (alias === "") {
        const parts = String(itemIn.name ?? "").split(".");
        alias = parts[parts.length - 1] ?? "";
        if (alias === "") continue;
      }
      const item = { ...itemIn, tag: "col" };
      const ret = Transform.createInlineValue(item, { name: "name" });
      items.push({ kind: "assign:expr", name: alias, value: ret });
    }
    blocks.push({ name, kind: "static:object", value: items });
  },

  onFilters(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    const items: KindNode[][] = [];
    for (const item of Object.values(data as object) as Array<Record<string, unknown>>) {
      const newItem: KindNode[] = [];
      DB.onPipeName(item.name ?? "", newItem);
      DB.onDisabled(item.disabled ?? false, newItem);
      DB.onArgs(item.arg ?? [], newItem);
      items.push(newItem);
    }
    blocks.push({ name: "filter", kind: "static:object[]", value: items });
  },

  onArgs(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    const items: KindNode[][] = [];
    for (const item of Object.values(data as object)) items.push([Transform.convertAssignmentValue(item)]);
    blocks.push({ name: "arg", kind: "static:object[]", value: items });
  },

  onDbo(data: unknown, blocks: KindNode[], name = "name"): void {
    let value: string;
    if (name === "table" && typeof data === "string" && data.includes(".")) {
      value = data;
    } else {
      try {
        value = script().mapIdToDboName(data);
      } catch {
        value = "";
      }
    }
    blocks.push({ name, kind: "static:text", value });
  },

  onAddon(data: unknown, blocks: KindNode[]): void {
    blocks.push({ name: "name", kind: "static:text", value: script().mapIdToAddonName(data) });
  },

  onJoin(data: unknown, blocks: KindNode[]): void {
    if (looseEquals(data, "inner")) return;
    blocks.push(Transform.inlineAssign("join", data));
  },

  onInline(data: unknown, blocks: KindNode[], key: string): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign(key, data));
  },

  onName(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign("name", data));
  },

  onPipeName(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    Transform.getPipeName(strval(data));
    blocks.push(Transform.inlineAssign("name", data));
  },

  onOffset(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign("offset", data));
  },

  onDisabled(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign("disabled", data, "static:bool"));
  },

  onDescription(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign("description", data, "static:text"));
  },

  onDocs(data: unknown, blocks: KindNode[]): void {
    if (phpEmpty(data)) return;
    blocks.push(Transform.inlineAssign("docs", data, "static:text"));
  },
};

void entries;
void mapperEmpty;
