import mysql, { type Pool, type PoolConnection } from "mysql2/promise";

declare global {
  var campusMysqlPool: Pool | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getPool(): Pool {
  if (!globalThis.campusMysqlPool) {
    const port = Number(process.env.MYSQL_PORT ?? "3306");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("MYSQL_PORT must be a valid TCP port.");
    }
    globalThis.campusMysqlPool = mysql.createPool({
      host: required("MYSQL_HOST"),
      port,
      user: required("MYSQL_USER"),
      password: required("MYSQL_PASSWORD"),
      database: required("MYSQL_DATABASE"),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: true,
    });
  }
  return globalThis.campusMysqlPool;
}

export async function getConnection(): Promise<PoolConnection> {
  return getPool().getConnection();
}
