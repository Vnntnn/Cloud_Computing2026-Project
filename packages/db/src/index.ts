import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ponytail: pool per process; the chart sets DB_POOL_MAX=4 (db.t3.micro ≈ 87 connections, 13 pods under HPA)
const max = Number(process.env.DB_POOL_MAX ?? 10);
export const db = drizzle(postgres(process.env.DATABASE_URL!, { max }), { schema });
export type DB = typeof db;

export * from "./schema";
export * from "./notifications";

export {
  eq, ne, and, or, not, inArray, notInArray, exists, notExists, isNull, isNotNull, desc, asc, sql, count, min, ilike, lt, lte, gt, gte,
  type SQL,
} from "drizzle-orm";
// a table under another name, to join it twice (e.g. users as buyer and as requester)
export { alias } from "drizzle-orm/pg-core";