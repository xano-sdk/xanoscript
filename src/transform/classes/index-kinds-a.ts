/** Core object kinds: Table, TableMap, Task, ApiGroup, Addon, Middleware, Workspace, Branch, WorkflowTest, and the table/workspace/error triggers. */
import type { ClassEncoder } from "../registry.js";
import { Addon } from "./Addon.js";
import { ApiGroup } from "./ApiGroup.js";
import { Branch } from "./Branch.js";
import { ErrorTrigger } from "./ErrorTrigger.js";
import { Middleware } from "./Middleware.js";
import { Table } from "./Table.js";
import { TableMap } from "./TableMap.js";
import { TableTrigger } from "./TableTrigger.js";
import { Task } from "./Task.js";
import { WorkflowTest } from "./WorkflowTest.js";
import { Workspace } from "./Workspace.js";
import { WorkspaceTrigger } from "./WorkspaceTrigger.js";

export const KIND_CLASSES_A: Record<string, ClassEncoder> = {
  Addon,
  ApiGroup,
  Branch,
  ErrorTrigger,
  Middleware,
  Table,
  TableMap,
  TableTrigger,
  Task,
  WorkflowTest,
  Workspace,
  WorkspaceTrigger,
};
