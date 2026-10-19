import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load migration/.env regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function req(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const env = {
  mysql: {
    host: opt('MYSQL_HOST', '127.0.0.1'),
    port: Number(opt('MYSQL_PORT', '3306')),
    db: req('MYSQL_DB'),
    user: req('MYSQL_USER'),
    password: opt('MYSQL_PASSWORD'),
  },
  ssh: {
    // Optional: when SSH_USER is empty, the source connects to MySQL directly
    // (local test / CI). Production sets these and tunnels.
    host: opt('SSH_HOST'),
    port: Number(opt('SSH_PORT', '22')),
    user: opt('SSH_USER'),
    privateKeyPath: opt('SSH_PRIVATE_KEY_PATH'),
    password: opt('SSH_PASSWORD'),
    localPort: Number(opt('SSH_LOCAL_PORT', '3307')),
  },
  mongo: {
    uri: req('MONGO_URI'),
    db: req('MONGO_DB'),
  },
};

export function readPrivateKey(): Buffer | undefined {
  if (!env.ssh.privateKeyPath) return undefined;
  return fs.readFileSync(env.ssh.privateKeyPath);
}
