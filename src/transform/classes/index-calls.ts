/** Call and misc statement transforms (ActionCall, ApiCall, ArrayMap, CloudJob*, GetRawInput, TaskCall, ToolCall, MarketItem, …). */
import type { ClassEncoder } from "../registry.js";
import { ActionCall } from "./ActionCall.js";
import { ActionPackageCall } from "./ActionPackageCall.js";
import { AddonCall } from "./AddonCall.js";
import { AgentRun } from "./AgentRun.js";
import { ApiCall } from "./ApiCall.js";
import { ArrayMap } from "./ArrayMap.js";
import { ArrayUnion } from "./ArrayUnion.js";
import { CloudJob } from "./CloudJob.js";
import { CloudJobAwait } from "./CloudJobAwait.js";
import { CloudJobStatus } from "./CloudJobStatus.js";
import { GetRawInput } from "./GetRawInput.js";
import { MarketItem } from "./MarketItem.js";
import { MiddlewareCall } from "./MiddlewareCall.js";
import { RunJob } from "./RunJob.js";
import { RunService } from "./RunService.js";
import { StackExpectToThrow } from "./StackExpectToThrow.js";
import { TaskCall } from "./TaskCall.js";
import { ToolCall } from "./ToolCall.js";
import { TriggerCall } from "./TriggerCall.js";
import { WorkflowTestCall } from "./WorkflowTestCall.js";

export const CALL_CLASSES: Record<string, ClassEncoder> = {
  ActionCall,
  ActionPackageCall,
  AddonCall,
  AgentRun,
  ApiCall,
  ArrayMap,
  ArrayUnion,
  CloudJob,
  CloudJobAwait,
  CloudJobStatus,
  GetRawInput,
  MarketItem,
  MiddlewareCall,
  RunJob,
  RunService,
  StackExpectToThrow,
  TaskCall,
  ToolCall,
  TriggerCall,
  WorkflowTestCall,
};
