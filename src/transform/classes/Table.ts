/** Port of redacted. */
import { script } from "../../engine/context.js";
import { count, isPhpArray, phpEmpty } from "../../engine/php.js";
import { Transform, type KindNode } from "../transform.js";

export const KIND = "schema:table";

export function Table(data: Record<string, unknown>): KindNode {
  const ret: KindNode = {
    kind: KIND,
    args: [{ name: "name", kind: "static:text", value: data.name }],
    blocks: [],
  };
  const blocks = ret.blocks as KindNode[];

  if (!phpEmpty(data.description)) blocks.push(Transform.inlineAssign("description", data.description));

  blocks.push(Transform.inlineAssign("auth", data.auth ?? false, "static:bool"));

  blocks.push(Transform.convertToKind("schema:schema", data.schema));

  createToSchemaTableIndex(ret, data.index ?? [], !phpEmpty(data.schema));
  createToSchemaTableAutocomplete(ret, data.autocomplete ?? []);
  createSchemaTableView(ret, data.views ?? []);
  Transform.createToSchemaTableTags(ret, data.tag ?? []);

  if (!phpEmpty(data.docs)) blocks.push(Transform.inlineAssign("docs", data.docs));

  if (script().getFeature("guid")) blocks.push(Transform.inlineAssign("guid", data.guid ?? ""));

  if (script().getFeature("tableItems")) blocks.push(Transform.inlineAssign("items", data.items ?? [], "static:array"));

  return ret;
}

/** The `createToSchemaTableIndex` helper of the PHP Table transform. */
function createToSchemaTableIndex(schema: KindNode, items: unknown, hasSchema = true): void {
  const blocks: KindNode[][] = [];

  if (isPhpArray(items) && !phpEmpty(items)) {
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      blocks.push(createToSchemaTableIndexItem(item));
    }
  }

  let hasPrimary = false;

  for (const blockNodes of blocks) {
    let hasType = false;
    let hasField = false;

    for (const blockNode of blockNodes) {
      switch (blockNode.name ?? "") {
        case "type":
          if ((blockNode.kind ?? "") === "static:text" && (blockNode.value ?? "") === "primary") {
            hasType = true;
          }
          break;
        case "field":
          if ((blockNode.kind ?? "") === "static:object[]" && isPhpArray(blockNode.value) && count(blockNode.value) == 1) {
            const first = ((blockNode.value as KindNode[][])[0] ?? [])[0];
            if ((first?.name ?? "") === "name" && (first?.value ?? "") === "id") {
              hasField = true;
            }
          }
          break;
      }
    }

    if (hasType && hasField) {
      hasPrimary = true;
      break;
    }
  }

  // Legacy/malformed tables sometimes have no schema fields and no indexes. Emit the index
  // block as empty rather than failing so the export still produces a valid (if empty) table.
  if (!hasPrimary && hasSchema) {
    throw new Error("Primary index is invalid or missing.");
  }

  (schema.blocks as KindNode[]).push(Transform.createStaticObject("index", blocks, true));
}

/** The `createToSchemaTableIndexItem` helper of the PHP Table transform. */
function createToSchemaTableIndexItem(item: Record<string, unknown>): KindNode[] {
  const blocks: KindNode[] = [];

  if (!phpEmpty(item.name ?? false)) {
    blocks.push(Transform.inlineAssign("name", item.name, "static:text"));
  }

  if (!phpEmpty(item.lang ?? false)) {
    blocks.push(Transform.inlineAssign("lang", item.lang, "static:text"));
  }

  blocks.push(Transform.inlineAssign("type", item.type, "static:text"));

  const fields = item.fields ?? [];
  if (!phpEmpty(fields)) {
    blocks.push(createToSchemaTableIndexField(fields));
  }

  return blocks;
}

/** The `createToSchemaTableIndexField` helper of the PHP Table transform. */
function createToSchemaTableIndexField(items: unknown): KindNode {
  const blocks: KindNode[][] = [];

  if (isPhpArray(items)) {
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      blocks.push(createToSchemaTableIndexFieldItem(item));
    }
  }

  return Transform.createStaticObject("field", blocks, true);
}

/** The `createToSchemaTableIndexFieldItem` helper of the PHP Table transform. */
function createToSchemaTableIndexFieldItem(item: Record<string, unknown>): KindNode[] {
  const blocks: KindNode[] = [];

  if (phpEmpty(item.name ?? "")) return blocks;

  blocks.push(Transform.inlineAssign("name", item.name, "static:text"));

  if (!phpEmpty(item.op ?? false)) {
    blocks.push(Transform.inlineAssign("op", item.op, "static:text"));
  }

  return blocks;
}

/** The `createToSchemaTableAutocomplete` helper of the PHP Table transform. */
function createToSchemaTableAutocomplete(schema: KindNode, items: unknown): void {
  if (isPhpArray(items) && !phpEmpty(items)) {
    const blocks: KindNode[][] = [];
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      blocks.push(createToSchemaTableAutocompleteItem(item));
    }
    (schema.blocks as KindNode[]).push(Transform.createStaticObject("autocomplete", blocks, true));
  }
}

/** The `createToSchemaTableAutocompleteItem` helper of the PHP Table transform. */
function createToSchemaTableAutocompleteItem(item: Record<string, unknown>): KindNode[] {
  const blocks: KindNode[] = [];

  if (phpEmpty(item.name ?? "")) return blocks;

  blocks.push(Transform.inlineAssign("name", item.name, "static:text"));

  return blocks;
}

/** The `createSchemaTableView` helper of the PHP Table transform. */
function createSchemaTableView(schema: KindNode, items: unknown): void {
  if (isPhpArray(items) && !phpEmpty(items)) {
    const blocks: KindNode[] = [];
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      blocks.push(createSchemaTableViewItem(item));
    }

    (schema.blocks as KindNode[]).push(Transform.createStaticObject("view", blocks));
  }
}

/** The `createSchemaTableViewItem` helper of the PHP Table transform. */
function createSchemaTableViewItem(item: Record<string, unknown>): KindNode {
  const blocks: KindNode[] = [];

  if (!phpEmpty(item.alias)) {
    blocks.push(Transform.inlineAssign("alias", item.alias, "static:text"));
  }

  if (!phpEmpty(item.q)) {
    blocks.push(Transform.inlineAssign("term", item.q, "static:text"));
  }

  if (!phpEmpty(item.expression)) {
    blocks.push(Transform.inlineAssign("search", Transform.createInlineComparison(item), "assign:expr"));
  }

  if (!phpEmpty(item.sort)) {
    blocks.push(createSchemaTableViewItemSort(item.sort));
  }

  if (!phpEmpty(item.hiddenCols)) {
    blocks.push(Transform.inlineAssign("hide", item.hiddenCols, "static:text[]"));
  }

  blocks.push(Transform.inlineAssign("id", item.id, "static:text"));

  return Transform.createStaticObject(item.name as string, blocks);
}

/** The `createSchemaTableViewItemSort` helper of the PHP Table transform. */
function createSchemaTableViewItemSort(items: unknown): KindNode {
  const blocks: KindNode[] = [];
  if (isPhpArray(items) && !phpEmpty(items)) {
    for (const item of Object.values(items as object) as Array<Record<string, unknown>>) {
      if (phpEmpty(item.name ?? "")) continue;
      blocks.push(Transform.inlineAssign(item.name as string, item.order ?? "asc"));
    }
  }
  return Transform.createStaticObject("sort", blocks);
}
