/**
 * The exception classes the engine's script parsers throw. The emitter only
 * needs to distinguish "parse failed" from other errors, so these carry a
 * message and the offending token; the engine's rich position bookkeeping is
 * not reproduced.
 */
export class ScriptError extends Error {
  constructor(message: string, public readonly index: number = -1) {
    super(message);
    this.name = "ScriptError";
  }
}

export class UnexpectedError extends ScriptError {
  constructor(public readonly syntaxIssue: string, index = -1) {
    super(`Unexpected syntax: ${JSON.stringify(syntaxIssue)}`, index);
    this.name = "UnexpectedError";
  }
}

export class ClosingError extends ScriptError {
  constructor(public readonly syntaxIssue: string, public readonly lookingFor: string) {
    super(`Missing closing ${JSON.stringify(lookingFor)} for ${JSON.stringify(syntaxIssue)}`);
    this.name = "ClosingError";
  }
}

export class NewlineError extends ScriptError {
  constructor(index = -1) {
    super("Unexpected newline", index);
    this.name = "NewlineError";
  }
}

export class MalformedError extends ScriptError {
  constructor(message: string) {
    super(message);
    this.name = "MalformedError";
  }
}

export class NotSupportedError extends ScriptError {
  constructor(message: string) {
    super(message);
    this.name = "NotSupportedError";
  }
}
