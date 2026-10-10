import pg from "pg";
import { env } from "../config.js";

let pool: pg.Pool | null = null;
/** One shared connection pool (Neon's pooled endpoint), created on first use. */
export const db = () => (pool ??= new pg.Pool({ connectionString: env("DATABASE_URL"), max: 3 }));
export const closeDb = async () => { await pool?.end(); pool = null; };
