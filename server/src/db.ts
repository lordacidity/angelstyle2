import pg from "pg";

let pool: pg.Pool | null = null;

function resolveConnectionString(): string {
  const raw = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL ?? "";
  if (!raw) {
    throw new Error(
      "Railway connection not set. Paste DATABASE_PUBLIC_URL from Railway's Connect panel into .env.",
    );
  }
  if (raw.includes("${")) {
    throw new Error(
      "DATABASE_PUBLIC_URL is still Railway's template form (${...}). " +
        "Paste the RESOLVED value (with real host:port from the Connect panel) into .env.",
    );
  }
  return raw;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new pg.Pool({
    connectionString: resolveConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}
