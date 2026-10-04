/**
 * Document-aware comparison of two XanoScript multidocs — the engine's
 * rendering of a workspace against the SDK's local rendering of the same
 * payload (`xanosdk preflight` with this module installed).
 *
 * Both sides are split on the `---` separator and paired by document
 * IDENTITY — type, name, verb and api group, read the way the pull layout
 * reads them — so one extra or missing document does not cascade into every
 * later document reading as changed, and two queries that share a name and
 * verb in different groups pair with their own twin whatever order the engine
 * happened to list them in. Within a pair the comparison is line-exact: the
 * emitter's contract is byte equality with the engine, so whitespace counts.
 */
import { parseDocument } from "./tree.js";

const SEPARATOR = "\n---\n";
/** Joins the parts of a document identity; a NUL, which no declaration can contain, spelled visibly. */
const IDENTITY_SEPARATOR = "\u0000";

export interface DocDiff {
  /** The document's declaration line, for display. */
  header: string;
  status: "changed" | "missing-local" | "missing-engine";
  /** First differing line number (1-based, within the document) when changed. */
  line?: number;
  engine?: string;
  local?: string;
  /** Every differing line as `[line, engine, local]` (undefined where a side ran out). */
  lines: Array<[number, string | undefined, string | undefined]>;
}

export interface MultidocDiff {
  docs: number;
  identical: number;
  diffs: DocDiff[];
}

/** The line a document is addressed by: its first non-comment, non-blank line. */
export function docHeader(doc: string): string {
  for (const line of doc.split("\n")) {
    const t = line.trim();
    if (t !== "" && !t.startsWith("//")) return t;
  }
  return doc.trim().split("\n")[0] ?? "";
}

/**
 * What makes a document the same document on both sides: its declared type
 * and name, plus the verb and api group that distinguish same-named queries.
 * A document the parser cannot read falls back to its header text.
 */
export function docIdentity(doc: string): string {
  const parsed = parseDocument(doc);
  if (parsed === null) return docHeader(doc);
  return [parsed.type, parsed.name, parsed.verb ?? "", parsed.apiGroup ?? ""].join(IDENTITY_SEPARATOR);
}

/** The identity `docIdentity` gives an api group document of this name. */
export function apiGroupIdentity(name: string): string {
  return ["api_group", name, "", ""].join(IDENTITY_SEPARATOR);
}

function splitDocs(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const body = text.replace(/\n$/, "");
  if (body === "") return map;
  for (const doc of body.split(SEPARATOR)) {
    const id = docIdentity(doc);
    const list = map.get(id) ?? [];
    list.push(doc);
    map.set(id, list);
  }
  return map;
}

/** Compare two multidocs; identical inputs yield `diffs: []`. */
export function diffMultidocs(engine: string, local: string): MultidocDiff {
  const engineDocs = splitDocs(engine);
  const localDocs = splitDocs(local);
  const diffs: DocDiff[] = [];
  let docs = 0;
  let identical = 0;

  for (const [id, list] of engineDocs) {
    const other = localDocs.get(id) ?? [];
    for (const [i, doc] of list.entries()) {
      docs++;
      const mine = other[i];
      if (mine === undefined) {
        diffs.push({ header: docHeader(doc), status: "missing-local", lines: [] });
        continue;
      }
      if (mine === doc) {
        identical++;
        continue;
      }
      const a = doc.split("\n");
      const b = mine.split("\n");
      const lines: DocDiff["lines"] = [];
      for (let n = 0; n < Math.max(a.length, b.length); n++) {
        if (a[n] !== b[n]) lines.push([n + 1, a[n], b[n]]);
      }
      const first = lines[0]!;
      diffs.push({ header: docHeader(doc), status: "changed", line: first[0], engine: first[1], local: first[2], lines });
    }
  }
  for (const [id, list] of localDocs) {
    const have = engineDocs.get(id)?.length ?? 0;
    for (let i = have; i < list.length; i++) {
      docs++;
      diffs.push({ header: docHeader(list[i]!), status: "missing-engine", lines: [] });
    }
  }
  return { docs, identical, diffs };
}

/** Which diff entries name a document with one of these identities. */
export function diffsFor(diff: MultidocDiff, identities: ReadonlySet<string>, engine: string): Set<DocDiff> {
  // Identities are only recoverable from the text, so re-derive the header → identity pairing.
  const byHeader = new Map<string, string>();
  for (const doc of engine.replace(/\n$/, "").split(SEPARATOR)) byHeader.set(docHeader(doc), docIdentity(doc));
  return new Set(diff.diffs.filter((d) => identities.has(byHeader.get(d.header) ?? "")));
}
