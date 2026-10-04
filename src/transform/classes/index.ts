/**
 * One entry per PHP transform class (redacted).
 * A class missing here makes `encodeWithClass` throw "not ported", which the
 * corpus harness reports per golden — the ratchet for the port's coverage.
 *
 * The map is assembled from four group files so ports can land independently:
 * `index-db.ts` (the db.* statements), `index-calls.ts` (call/misc statements),
 * `index-kinds-a.ts` (table/task/api_group/workspace kinds and their triggers),
 * `index-kinds-b.ts` (AI, realtime and microservice kinds).
 */
import type { ClassEncoder } from "../registry.js";
import { Conditional } from "./Conditional.js";
import { ElseIfStack } from "./ElseIfStack.js";
import { ElseStack } from "./ElseStack.js";
import { ForLoop } from "./ForLoop.js";
import { FunctionCall } from "./FunctionCall.js";
import { FunctionRun } from "./FunctionRun.js";
import { FunctionTransform } from "./FunctionTransform.js";
import { Group } from "./Group.js";
import { IfStack } from "./IfStack.js";
import { Query } from "./Query.js";
import { Response } from "./Response.js";
import { DB_CLASSES } from "./index-db.js";
import { CALL_CLASSES } from "./index-calls.js";
import { KIND_CLASSES_A } from "./index-kinds-a.js";
import { KIND_CLASSES_B } from "./index-kinds-b.js";

export const CLASS_ENCODERS: Record<string, ClassEncoder> = {
  Conditional,
  ElseIfStack,
  ElseStack,
  ForLoop,
  FunctionCall,
  FunctionRun,
  FunctionTransform,
  Group,
  IfStack,
  Query,
  Response,
  ...DB_CLASSES,
  ...CALL_CLASSES,
  ...KIND_CLASSES_A,
  ...KIND_CLASSES_B,
};
