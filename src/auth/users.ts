/**
 * File-backed account store (SERVER ONLY).
 *
 * The project intentionally has no database. Accounts live in a git-ignored
 * JSON file next to the order store, written atomically. This is a local demo
 * store, not durable deployed persistence — documented honestly.
 *
 * Only password HASHES and salts are stored. Public projections never include
 * them, and no route returns or logs them.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface UsersFile {
  version: 1;
  users: UserRecord[];
}

let dataDir: string | null = null;
let resolvedDir: string | null = null;

/** Tests point this at a temp directory; production uses ./data or USER_STORE_DIR. */
export function setUserDataDir(dir: string | null): void {
  dataDir = dir;
  resolvedDir = dir;
}

function resolveStoreDir(): string {
  if (resolvedDir) return resolvedDir;
  const preferred =
    dataDir ??
    (process.env.USER_STORE_DIR?.trim()
      ? path.resolve(process.env.USER_STORE_DIR.trim())
      : path.join(process.cwd(), "data"));
  try {
    mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, `.paypilot-users-probe-${process.pid}`);
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    resolvedDir = preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), "neednet-users");
    mkdirSync(fallback, { recursive: true });
    resolvedDir = fallback;
  }
  return resolvedDir;
}

function usersPath(): string {
  return path.join(resolveStoreDir(), "users.json");
}

let writeQueue: Promise<void> = Promise.resolve();

function mutate(mutator: (users: UserRecord[]) => "skip" | void): Promise<void> {
  const run = writeQueue.then(() => {
    const file = usersPath();
    let store: UsersFile = { version: 1, users: [] };
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as UsersFile;
      if (parsed && Array.isArray(parsed.users)) store = { version: 1, users: parsed.users };
    } catch {
      // first run — start empty
    }
    if (mutator(store.users) === "skip") return;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmp, file);
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

/** Create an account; returns null when the email is already registered. */
export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  passwordSalt: string;
}): Promise<UserRecord | null> {
  const email = normalizeEmail(input.email);
  let created: UserRecord | null = null;
  await mutate((users) => {
    if (users.some((u) => u.email === email)) return "skip" as const;
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: `usr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      email,
      name: input.name,
      passwordHash: input.passwordHash,
      passwordSalt: input.passwordSalt,
      createdAt: now,
    };
    users.push(user);
    created = user;
  });
  return created;
}

export function findUserByEmail(email: string): UserRecord | null {
  const normalized = normalizeEmail(email);
  try {
    const parsed = JSON.parse(readFileSync(usersPath(), "utf8")) as UsersFile;
    return parsed.users.find((u) => u.email === normalized) ?? null;
  } catch {
    return null;
  }
}

export function findUserById(id: string): UserRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(usersPath(), "utf8")) as UsersFile;
    return parsed.users.find((u) => u.id === id) ?? null;
  } catch {
    return null;
  }
}
