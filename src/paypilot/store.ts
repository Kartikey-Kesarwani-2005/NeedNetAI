/**
 * PayPilot data store (SERVER ONLY).
 *
 * Budgets, agent activity and confirmation-gated payment intents live in a
 * single atomic JSON file under `data/` (git-ignored). This mirrors the
 * existing order-store pattern: local demo persistence, not a deployed DB.
 * Every read is scoped by userId; no cross-account aggregation is exposed.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ActivityEntry,
  ActivityKind,
  ActivitySource,
  BudgetSettings,
  PaymentIntent,
  PaymentIntentStatus,
} from "./types";

interface PilotFile {
  version: 1;
  budgets: Record<string, BudgetSettings>;
  activities: ActivityEntry[];
  intents: PaymentIntent[];
}

const MAX_ACTIVITIES = 1_200;
const MAX_INTENTS = 800;
const INTENT_TTL_MS = 10 * 60 * 1000;

let dataDir: string | null = null;
let resolvedDir: string | null = null;

export function setPayPilotDataDir(dir: string | null): void {
  dataDir = dir;
  resolvedDir = dir;
}

function resolveStoreDir(): string {
  if (resolvedDir) return resolvedDir;
  const preferred =
    dataDir ??
    (process.env.PAYPILOT_STORE_DIR?.trim()
      ? path.resolve(process.env.PAYPILOT_STORE_DIR.trim())
      : path.join(process.cwd(), "data"));
  try {
    mkdirSync(preferred, { recursive: true });
    const probe = path.join(preferred, `.paypilot-probe-${process.pid}`);
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    resolvedDir = preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), "neednet-paypilot");
    mkdirSync(fallback, { recursive: true });
    resolvedDir = fallback;
  }
  return resolvedDir;
}

function storePath(): string {
  return path.join(resolveStoreDir(), "paypilot.json");
}

function emptyFile(): PilotFile {
  return { version: 1, budgets: {}, activities: [], intents: [] };
}

function readFile(): PilotFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as PilotFile;
    if (!parsed || parsed.version !== 1) return emptyFile();
    return {
      version: 1,
      budgets: parsed.budgets && typeof parsed.budgets === "object" ? parsed.budgets : {},
      activities: Array.isArray(parsed.activities) ? parsed.activities : [],
      intents: Array.isArray(parsed.intents) ? parsed.intents : [],
    };
  } catch {
    return emptyFile();
  }
}

let writeQueue: Promise<void> = Promise.resolve();

function mutate(mutator: (file: PilotFile) => "skip" | void): Promise<void> {
  const run = writeQueue.then(() => {
    const file = storePath();
    const store = readFile();
    if (mutator(store) === "skip") return;
    prune(store);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmp, file);
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

function prune(store: PilotFile): void {
  if (store.activities.length > MAX_ACTIVITIES) {
    store.activities = store.activities.slice(-MAX_ACTIVITIES);
  }
  if (store.intents.length > MAX_INTENTS) {
    const terminal = (s: PaymentIntentStatus) => s === "captured" || s === "failed" || s === "cancelled" || s === "expired";
    const keep = store.intents.filter((i) => !terminal(i.status)).slice(-200);
    const closed = store.intents.filter((i) => terminal(i.status)).slice(-(MAX_INTENTS - keep.length));
    store.intents = [...closed, ...keep];
  }
}

/* ── Budget ────────────────────────────────────────────── */

export function getBudget(userId: string): BudgetSettings | null {
  return readFile().budgets[userId] ?? null;
}

export async function saveBudget(userId: string, settings: Omit<BudgetSettings, "updatedAt">): Promise<BudgetSettings> {
  const saved: BudgetSettings = { ...settings, updatedAt: new Date().toISOString() };
  await mutate((store) => {
    store.budgets[userId] = saved;
  });
  return saved;
}

/* ── Activity ──────────────────────────────────────────── */

export interface ActivityInput {
  userId: string;
  kind: ActivityKind;
  source: ActivitySource;
  summary: string;
  reference?: string;
}

function cleanSummary(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);
}

export async function appendActivity(input: ActivityInput): Promise<ActivityEntry | null> {
  const summary = cleanSummary(input.summary);
  if (!input.userId || summary.length === 0) return null;
  const entry: ActivityEntry = {
    id: `act_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    userId: input.userId,
    at: new Date().toISOString(),
    kind: input.kind,
    source: input.source,
    summary,
    ...(input.reference ? { reference: input.reference } : {}),
  };
  try {
    await mutate((store) => {
      store.activities.push(entry);
    });
    return entry;
  } catch {
    return null;
  }
}

export function listActivity(userId: string, limit = 60): ActivityEntry[] {
  const cap = Math.max(1, Math.min(200, Math.floor(limit)));
  return readFile()
    .activities.filter((a) => a.userId === userId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, cap);
}

/* ── Payment intents ───────────────────────────────────── */

export async function createPaymentIntent(
  input: Omit<PaymentIntent, "id" | "status" | "confirmationCode" | "reference" | "paypalOrderId" | "createdAt" | "expiresAt" | "confirmedAt">,
): Promise<PaymentIntent> {
  const id = `ppi_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const now = Date.now();
  const intent: PaymentIntent = {
    ...input,
    id,
    status: "awaiting_confirmation",
    confirmationCode: randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
    reference: null,
    paypalOrderId: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INTENT_TTL_MS).toISOString(),
    confirmedAt: null,
  };
  await mutate((store) => {
    store.intents.push(intent);
  });
  return intent;
}

export function findPaymentIntent(id: string): PaymentIntent | null {
  return readFile().intents.find((i) => i.id === id) ?? null;
}

/** The most recent open intent for this exact buyer+offer, if still usable. */
export function findOpenPaymentIntent(userId: string, buyerId: string, offerId: string): PaymentIntent | null {
  const now = Date.now();
  return (
    [...readFile().intents]
      .reverse()
      .find(
        (i) =>
          i.userId === userId &&
          i.buyerId === buyerId &&
          i.offerId === offerId &&
          (i.status === "awaiting_confirmation" || i.status === "checkout_created") &&
          new Date(i.expiresAt).getTime() > now,
      ) ?? null
  );
}

export function findIntentByReference(reference: string): PaymentIntent | null {
  return readFile().intents.find((i) => i.reference === reference) ?? null;
}

export async function updatePaymentIntent(
  id: string,
  patch: Partial<Pick<PaymentIntent, "status" | "reference" | "paypalOrderId" | "confirmedAt">>,
): Promise<PaymentIntent | null> {
  let updated: PaymentIntent | null = null;
  await mutate((store) => {
    const intent = store.intents.find((i) => i.id === id);
    if (!intent) return "skip" as const;
    Object.assign(intent, patch);
    updated = intent;
  });
  return updated;
}
