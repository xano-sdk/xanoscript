/** The `db.*` statement transforms (DbAdd, DbEdit, DbBulk*, DirectQuery, External*DirectQuery, DbTransaction, DbAddOrEdit). */
import type { ClassEncoder } from "../registry.js";
import { DbAdd } from "./DbAdd.js";
import { DbAddOrEdit } from "./DbAddOrEdit.js";
import { DbBulkAdd } from "./DbBulkAdd.js";
import { DbBulkDelete } from "./DbBulkDelete.js";
import { DbBulkPatch } from "./DbBulkPatch.js";
import { DbBulkUpdate } from "./DbBulkUpdate.js";
import { DbEdit } from "./DbEdit.js";
import { DbTransaction } from "./DbTransaction.js";
import { DirectQuery } from "./DirectQuery.js";
import { ExternalMssqlDirectQuery } from "./ExternalMssqlDirectQuery.js";
import { ExternalMysqlDirectQuery } from "./ExternalMysqlDirectQuery.js";
import { ExternalOracleDirectQuery } from "./ExternalOracleDirectQuery.js";
import { ExternalPostgresDirectQuery } from "./ExternalPostgresDirectQuery.js";
import { ExternalSnowflakeDirectQuery } from "./ExternalSnowflakeDirectQuery.js";

export const DB_CLASSES: Record<string, ClassEncoder> = {
  DbAdd,
  DbAddOrEdit,
  DbBulkAdd,
  DbBulkDelete,
  DbBulkPatch,
  DbBulkUpdate,
  DbEdit,
  DbTransaction,
  DirectQuery,
  ExternalMssqlDirectQuery,
  ExternalMysqlDirectQuery,
  ExternalOracleDirectQuery,
  ExternalPostgresDirectQuery,
  ExternalSnowflakeDirectQuery,
};
