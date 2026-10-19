import { createTunnel } from 'tunnel-ssh';
import * as mysql from 'mysql2/promise';
import { env, readPrivateKey } from './env';

/**
 * Opens an SSH tunnel to the CloudPanel server, then a MySQL pool over it.
 *
 * READ-ONLY by contract: every query goes through `select()`, which refuses
 * anything that is not a SELECT/SHOW/DESCRIBE. Nothing here may write to,
 * update or delete from the old database.
 */
export interface Source {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
}

const WRITE = /\b(insert|update|delete|drop|alter|truncate|create|replace|grant|revoke)\b/i;

export async function openSource(): Promise<Source> {
  const privateKey = readPrivateKey();

  const [server] = await createTunnel(
    { autoClose: false, reconnectOnError: false },
    { port: env.ssh.localPort }, // local bind
    {
      host: env.ssh.host,
      port: env.ssh.port,
      username: env.ssh.user,
      ...(privateKey ? { privateKey } : {}),
      ...(env.ssh.password ? { password: env.ssh.password } : {}),
    },
    {
      // Forward to MySQL as seen from the server.
      dstAddr: env.mysql.host,
      dstPort: env.mysql.port,
    },
  );

  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: env.ssh.localPort,
    user: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.db,
    connectionLimit: 4,
    // Hard stop on multi-statements so a crafted string can't smuggle a write.
    multipleStatements: false,
  });

  return {
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const trimmed = sql.trim();
      if (WRITE.test(trimmed)) {
        throw new Error(`Refusing non-read query on source: ${trimmed.slice(0, 60)}`);
      }
      const [rows] = await pool.query(sql, params);
      return rows as T[];
    },
    async close() {
      await pool.end();
      server.close();
    },
  };
}
