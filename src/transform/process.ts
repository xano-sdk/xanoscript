/** Port of redacted: kind tree → validated value → text. */
import { script } from "../engine/context.js";
import { Transform } from "./transform.js";

export function processConvert(kind: string, data: unknown): { kind: string; output: string } {
  const ret = Transform.convertToKind(kind, data);
  const k = script().getKind(ret.kind);
  const value = k.parse(ret);
  let output = value.toString();
  output = output.split("\r\n").join("\n");
  return { kind: ret.kind, output };
}
