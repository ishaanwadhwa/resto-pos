import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    console.log("🔌 [DB] Creating new pool...");
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 5000,
      keepAlive: true,
    } as any);
    
    pool.on('error', (err) => console.error('❌ [DB] Pool error:', err));
  }
  return pool;
}
