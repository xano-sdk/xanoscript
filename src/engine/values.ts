/**
 * Value wrappers the engine's renderer passes around.
 *
 * Ports of redacted, redacted and Symfony's
 * TaggedValue as the encoder uses it (`!tag value` verbose renderings).
 */
import { renderState } from "./state.js";
import { indent } from "./system.js";
import { Parser } from "./parser.js";

/** A pre-rendered fragment the wrapper must emit verbatim. */
export class RawValue {
  constructor(private readonly value: string) {}
  getValue(): string {
    return this.value;
  }
  toString(): string {
    return this.value;
  }
  jsonSerialize(): unknown {
    return this.value;
  }
}

/** Symfony `TaggedValue`: `!tag value`. */
export class TaggedValue {
  constructor(private readonly tag: string, private readonly value: unknown) {}
  getTag(): string {
    return this.tag;
  }
  getValue(): unknown {
    return this.value;
  }
}

/** A string rendered as a `"""`/`'''`/```` ``` ```` block when long enough. */
export class MultiLineValue {
  static readonly MAX_LINE_THRESHHOLD = 48;
  static readonly MAX_NEWLINE_THRESHHOLD = 5;

  constructor(
    private readonly value: string,
    private readonly type: string,
    private readonly indentCols: number,
    _multiline = true,
  ) {}

  getValue(): string {
    return this.value;
  }

  indent(indentCols: number): string {
    let sep = this.type === "const:expr" || this.type === "const:expr2" ? "```" : '"""';

    if (sep === '"""') {
      if (
        !renderState.multilineForce &&
        !(this.value.length > MultiLineValue.MAX_LINE_THRESHHOLD || (this.value.split("\n").length - 1) > MultiLineValue.MAX_NEWLINE_THRESHHOLD) &&
        !this.value.includes(sep)
      ) {
        return Parser.wrap(this.value, Parser.QUOTE_CHAR);
      }

      if (this.value.includes(sep)) {
        sep = "'''";
      }
    }

    return `${sep}\n${indent(this.value, indentCols)}\n${indent(sep, indentCols)}`;
  }

  toString(): string {
    return this.indent(this.indentCols);
  }

  jsonSerialize(): unknown {
    return this.value;
  }
}
