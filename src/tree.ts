/**
 * The one-file-per-object layout of a XanoScript workspace — where each
 * document of a multidoc lands on disk.
 *
 * This is the layout `xano workspace pull` writes and `xano workspace push`
 * reads, ported rule for rule from the Xano CLI's placement (its
 * `document-parser.ts`), so a tree written here is interchangeable with a
 * pulled one: `api/<group>/<path>/<name>_<VERB>.xs`, `function/<name>.xs`,
 * `table/<name>.xs`, realtime servers nesting their channels nesting their
 * messages, and so on. Names are snake_cased by the same library the CLI uses.
 *
 * Pure: no filesystem. `placeMultidoc` turns a multidoc string into
 * `{ relPath, content }` pairs; the writer in `src/emit/` puts them on disk.
 */
import snakeCase from "lodash.snakecase";

/** A document's header facts, as the CLI reads them off the text. */
export interface ParsedDocument {
  apiGroup?: string;
  canonical?: string;
  /** Owning channel path for realtime v2 `message` documents. */
  channel?: string;
  content: string;
  guid?: string;
  name: string;
  /** Owning realtime_server name for realtime v2 `channel` documents. */
  server?: string;
  type: string;
  verb?: string;
}

/** A document's resolved location relative to the tree root, plus its content. */
export interface PlacedDocument {
  content: string;
  /** POSIX-style path relative to the root, e.g. `api/pdf/documents_GET.xs`. */
  relPath: string;
}

const SEPARATOR = "\n---\n";

/**
 * Parse one document's type, name and the references its placement needs.
 * Leading `//` comment lines are skipped to find the declaration.
 */
export function parseDocument(content: string): ParsedDocument | null {
  let firstLine: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("//")) {
      firstLine = trimmed;
      break;
    }
  }
  if (!firstLine) return null;

  // `type name {`, `type name verb=GET {`, `type "name with spaces" {`
  const match = firstLine.match(/^(\w+)\s+("(?:[^"\\]|\\.)*"|\S+)(?:\s+(.*))?/);
  if (!match) return null;

  const type = match[1]!;
  let name = match[2]!;
  const rest = match[3] ?? "";
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);

  const verb = rest.match(/verb=(\S+)/)?.[1];
  const apiGroup = content.match(/api_group\s*=\s*"([^"]*)"/)?.[1];
  // A realtime v2 message names its channel by PATH; a channel (and a message)
  // names its realtime_server by NAME. Both are what nest them on disk.
  const channel = content.match(/^\s*channel\s*=\s*"([^"]*)"/m)?.[1];
  const server = content.match(/^\s*realtime_server\s*=\s*"([^"]*)"/m)?.[1];
  const canonical = content.match(/canonical\s*=\s*"([^"]*)"/)?.[1];
  const guid = content.match(/guid\s*=\s*"([^"]*)"/)?.[1];

  return { apiGroup, canonical, channel, content, guid, name, server, type, verb };
}

/** Split a multidoc into parsed documents, skipping empties and unparseable fragments. */
export function splitMultidoc(blob: string): ParsedDocument[] {
  const documents: ParsedDocument[] = [];
  for (const raw of blob.split(SEPARATOR)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = parseDocument(trimmed);
    if (parsed) documents.push(parsed);
  }
  return documents;
}

/**
 * A realtime v2 channel path as directory segments: `rooms/{room_id}` →
 * `["rooms", "[room_id]"]`. Braces become brackets (legal on every filesystem,
 * awkward in shells only), and are kept rather than dropped so a parameterized
 * channel stays distinct from a literal one named `rooms/room_id`.
 */
export function channelPathSegments(name: string): string[] {
  const isParam = /^\{.*\}$/;
  return name.split("/").map((segment) => (isParam.test(segment) ? `[${segment.slice(1, -1)}]` : snakeCase(segment)));
}

/** One filename segment for a document name: quotes stripped, snake_cased. */
export function sanitizeDocumentName(name: string): string {
  return snakeCase(name.replaceAll('"', ""));
}

/** v2 channel path → owning realtime_server name, from the batch's channel documents. */
function buildChannelServerResolver(documents: ParsedDocument[]): (channelName: string) => string | undefined {
  const channelToServer = new Map<string, string>();
  for (const doc of documents) {
    if (doc.type === "channel" && doc.server) channelToServer.set(doc.name, doc.server);
  }
  return (channelName) => channelToServer.get(channelName);
}

/**
 * api_group name → unique folder. Two groups whose names snake_case to the same
 * folder (`Authentication` and `authentication`) get `_2`, `_3` suffixes after
 * the first, in document order.
 */
function buildApiGroupFolderResolver(documents: ParsedDocument[]): (groupName: string) => string {
  const folderClaims = new Map<string, string[]>();
  for (const doc of documents) {
    if (doc.type !== "api_group") continue;
    const folder = snakeCase(doc.name);
    const names = folderClaims.get(folder) ?? [];
    if (!names.includes(doc.name)) names.push(doc.name);
    folderClaims.set(folder, names);
  }
  const map = new Map<string, string>();
  for (const [folder, names] of folderClaims) {
    map.set(names[0]!, folder);
    for (let i = 1; i < names.length; i++) map.set(names[i]!, `${folder}_${i + 1}`);
  }
  return (groupName) => map.get(groupName) ?? snakeCase(groupName);
}

const join = (...parts: string[]): string => parts.filter((p) => p !== "").join("/");

/** The directory and base filename (no extension, no duplicate suffix) a document is written to. */
export function resolveDocumentPath(
  doc: ParsedDocument,
  deps: { getApiGroupFolder: (groupName: string) => string; getChannelServer: (channelName: string) => string | undefined },
): { baseName: string; typeDir: string } {
  const { getApiGroupFolder, getChannelServer } = deps;
  const sanitize = sanitizeDocumentName;

  if (doc.type === "workspace") return { baseName: sanitize(doc.name), typeDir: "workspace" };
  if (doc.type === "workspace_trigger" || doc.type === "error_trigger") {
    return { baseName: sanitize(doc.name), typeDir: join("workspace", "trigger") };
  }
  if (doc.type === "agent") return { baseName: sanitize(doc.name), typeDir: join("ai", "agent") };
  if (doc.type === "mcp_server") return { baseName: sanitize(doc.name), typeDir: join("ai", "mcp_server") };
  if (doc.type === "tool") return { baseName: sanitize(doc.name), typeDir: join("ai", "tool") };
  if (doc.type === "agent_trigger") return { baseName: sanitize(doc.name), typeDir: join("ai", "agent", "trigger") };
  if (doc.type === "mcp_server_trigger") return { baseName: sanitize(doc.name), typeDir: join("ai", "mcp_server", "trigger") };
  if (doc.type === "table_trigger") return { baseName: sanitize(doc.name), typeDir: join("table", "trigger") };
  if (doc.type === "realtime_channel") return { baseName: sanitize(doc.name), typeDir: join("realtime", "channel") };
  if (doc.type === "realtime_trigger") return { baseName: sanitize(doc.name), typeDir: join("realtime", "trigger") };

  if (doc.type === "realtime_server_trigger") {
    // Nests under its server; a server-less (legacy) document stays under realtime/.
    return {
      baseName: sanitize(doc.name),
      typeDir: doc.server ? join("realtime", "server", sanitize(doc.server), "trigger") : join("realtime", "server_trigger"),
    };
  }

  if (doc.type === "channel_trigger") {
    if (doc.server && doc.channel) {
      return {
        baseName: sanitize(doc.name),
        typeDir: join("realtime", "server", sanitize(doc.server), "channel", snakeCase(doc.channel), "trigger"),
      };
    }
    if (doc.channel) {
      return { baseName: sanitize(doc.name), typeDir: join("channel", ...channelPathSegments(doc.channel), "trigger") };
    }
    return { baseName: sanitize(doc.name), typeDir: join("realtime", "channel_trigger") };
  }

  if (doc.type === "realtime_server") {
    // `realtime_server "chat"` → realtime/server/chat/chat.xs (mirrors api/<group>/<group>.xs).
    return { baseName: sanitize(doc.name), typeDir: join("realtime", "server", sanitize(doc.name)) };
  }

  if (doc.type === "channel") {
    // `channel "rooms/{room_id}"` on server chat → realtime/server/chat/channel/rooms_room_id/rooms_room_id.xs;
    // a channel with no resolvable server takes the legacy channel/<path>/_channel.xs layout.
    if (doc.server) {
      return { baseName: snakeCase(doc.name), typeDir: join("realtime", "server", sanitize(doc.server), "channel", snakeCase(doc.name)) };
    }
    return { baseName: "_channel", typeDir: join("channel", ...channelPathSegments(doc.name)) };
  }

  if (doc.type === "message" && doc.channel) {
    // Under its channel's message/ folder: message names are unique only within
    // a channel. The message's own `realtime_server` line is authoritative; the
    // channel → server map only covers a document that lacks one, because two
    // servers may each hold a channel of the same path.
    const messageServer = doc.server ?? getChannelServer(doc.channel);
    return {
      baseName: sanitize(doc.name),
      typeDir: messageServer
        ? join("realtime", "server", sanitize(messageServer), "channel", snakeCase(doc.channel), "message")
        : join("channel", ...channelPathSegments(doc.channel)),
    };
  }

  if (doc.type === "api_group") return { baseName: sanitize(doc.name), typeDir: join("api", getApiGroupFolder(doc.name)) };

  if (doc.type === "query" && doc.apiGroup) {
    // api/<group>/<path segments>/<name>_<VERB>.xs
    const groupFolder = getApiGroupFolder(doc.apiGroup);
    const nameParts = doc.name.split("/");
    const leafName = nameParts.pop()!;
    const baseName = sanitize(leafName);
    return {
      baseName: doc.verb ? `${baseName}_${doc.verb}` : baseName,
      typeDir: join("api", groupFolder, ...nameParts.map((part) => snakeCase(part))),
    };
  }

  // Everything else: <type>/<path segments>/<name>[_<VERB>].xs
  const nameParts = doc.name.split("/");
  const leafName = nameParts.pop()!;
  const baseName = sanitize(leafName);
  return {
    baseName: doc.verb ? `${baseName}_${doc.verb}` : baseName,
    typeDir: join(doc.type, ...nameParts.map((part) => snakeCase(part))),
  };
}

/**
 * Where each document of a batch lands: `resolveDocumentPath` plus the `.xs`
 * extension, with a `_N` suffix on a second document that would take a name
 * already used in the same directory (`say.xs`, then `say_2.xs`).
 */
export function placeDocuments(documents: ParsedDocument[]): PlacedDocument[] {
  const getApiGroupFolder = buildApiGroupFolderResolver(documents);
  const getChannelServer = buildChannelServerResolver(documents);
  const counters = new Map<string, Map<string, number>>();
  const placed: PlacedDocument[] = [];
  for (const doc of documents) {
    const { baseName, typeDir } = resolveDocumentPath(doc, { getApiGroupFolder, getChannelServer });
    const perDir = counters.get(typeDir) ?? new Map<string, number>();
    counters.set(typeDir, perDir);
    const count = perDir.get(baseName) ?? 0;
    perDir.set(baseName, count + 1);
    const filename = count === 0 ? `${baseName}.xs` : `${baseName}_${count + 1}.xs`;
    placed.push({ content: doc.content, relPath: join(typeDir, filename) });
  }
  return placed;
}

/** A multidoc as the files `xano workspace pull` would write for it. */
export function placeMultidoc(multidoc: string): PlacedDocument[] {
  return placeDocuments(splitMultidoc(multidoc));
}

/** Every document type a workspace multidoc can carry. */
const DOCUMENT_TYPES = [
  "workspace", "table", "function", "middleware", "api_group", "query", "task", "addon", "agent", "mcp_server", "tool",
  "agent_trigger", "mcp_server_trigger", "workflow_test", "realtime_channel", "realtime_server", "channel", "message",
  "microservice", "workspace_trigger", "table_trigger", "realtime_trigger", "realtime_server_trigger", "channel_trigger",
  "error_trigger",
];

/**
 * The top-level directories the layout can write into, derived from the
 * placement rules themselves (each type placed with and without the references
 * that change its home), so a writer that owns the tree prunes every directory
 * a document could have landed in.
 */
export function layoutRoots(): string[] {
  const roots = new Set<string>();
  const deps = { getApiGroupFolder: (g: string) => snakeCase(g), getChannelServer: () => undefined };
  for (const type of DOCUMENT_TYPES) {
    for (const refs of [{}, { apiGroup: "g", server: "s", channel: "c" }, { channel: "c" }]) {
      const doc: ParsedDocument = { type, name: "n", content: "", ...refs };
      roots.add(resolveDocumentPath(doc, deps).typeDir.split("/")[0]!);
    }
  }
  return [...roots].sort();
}
