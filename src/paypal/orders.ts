/**
 * Pending/internal order store (SERVER ONLY).
 *
 * The project has no database; per the Phase 4 brief this is the smallest
 * safe solution compatible with the current architecture: a JSON file under
 * `data/` (git-ignored), written atomically (temp file + rename). It keeps
 * the demo usable across hard reloads and captures server-side state —
 * but it is a LOCAL demo store, not durable deployed persistence. This is
 * documented honestly in the README.
 *
 * State machine:
 *   created        → pending PayPal approval (internal order exists)
 *   created        → captured (verified) | cancelled | failed
 *   captured       → terminal (repeat capture returns the same result)
 *   cancelled      → terminal (retry creates a NEW internal order)
 *   failed         → terminal (retry creates a NEW internal order)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export type OrderStatus = "created" | "captured" | "cancelled" | "failed";

export interface DemoOrder {
  /** Internal reference — the only id shown to the client before capture */
  reference: string;
  groupId: string;
  offerId: string;
  buyerId: string;
  sellerName: string;
  strategyLabel: string;
  /** Server-computed share for the purchasing buyer (authoritative) */
  amount: string; // "123.45"
  currency: "EUR";
  status: OrderStatus;
  paypalOrderId: string | null;
  captureId: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

interface StoreFile {
  version: 1;
  orders: DemoOrder[];
}

let dataDir: string | null = null;

/** Tests point this at a temp dir; production uses <project>/data. */
export function setOrderDataDir(dir: string | null): void {
  dataDir = dir;
}

function ordersPath(): string {
  return path.join(dataDir ?? path.join(process.cwd(), "data"), "orders.json");
}

/** Serialize writes; Next dev can interleave, JS runs these on one loop. */
let writeQueue: Promise<void> = Promise.resolve();

/** Mutator mutates the array in place; "skip" aborts the write. */
function mutate(mutator: (orders: DemoOrder[]) => "skip" | void): Promise<void> {
  const run = writeQueue.then(() => {
    const file = ordersPath();
    let store: StoreFile = { version: 1, orders: [] };
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as StoreFile;
      if (parsed && Array.isArray(parsed.orders)) store = { version: 1, orders: parsed.orders };
    } catch {
      // first run or transient read — start fresh; no false order recovery
    }
    if (mutator(store.orders) === "skip") return;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    renameSync(tmp, file);
  });
  writeQueue = run.catch(() => undefined); // never poison the queue
  return run;
}

export async function createOrder(
  input: Omit<DemoOrder, "reference" | "status" | "createdAt" | "updatedAt" | "captureId" | "capturedAt"> & {
    /** Optional pre-generated reference (route generates before PayPal call). */
    reference?: string;
  },
): Promise<{ reference: string }> {
  const now = new Date().toISOString();
  const order: DemoOrder = {
    ...input,
    reference: input.reference ?? newOrderReference(),
    status: "created",
    createdAt: now,
    updatedAt: now,
    captureId: null,
    capturedAt: null,
  };
  await mutate((orders) => {
    orders.push(order); // always a real creation — always written
  });
  return { reference: order.reference };
}

/** Visible, collision-resistant internal reference (route may pre-generate). */
export function newOrderReference(): string {
  return `nno-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function findOrder(reference: string): DemoOrder | null {
  try {
    const parsed = JSON.parse(readFileSync(ordersPath(), "utf8")) as StoreFile;
    return parsed.orders.find((o) => o.reference === reference) ?? null;
  } catch {
    return null;
  }
}

export function listOrders(): DemoOrder[] {
  try {
    const parsed = JSON.parse(readFileSync(ordersPath(), "utf8")) as StoreFile;
    return [...parsed.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** Terminal-safe status update; returns the stored order, or null if raced. */
export async function updateOrderStatus(
  reference: string,
  patch: { status: OrderStatus; captureId?: string; capturedAt?: string },
): Promise<DemoOrder | null> {
  let updated: DemoOrder | null = null;
  await mutate((orders) => {
    const order = orders.find((o) => o.reference === reference);
    if (!order) return "skip" as const;
    // Terminal guards: a captured/cancelled/failed order never mutates again.
    if (order.status !== "created") return "skip" as const;
    order.status = patch.status;
    if (patch.captureId != null) order.captureId = patch.captureId;
    if (order.status === "captured") {
      order.capturedAt = patch.capturedAt ?? new Date().toISOString();
    }
    order.updatedAt = new Date().toISOString();
    updated = order;
  });
  return updated;
}

/** Client-facing projection — secrets never exist in orders, but keep it explicit. */
export function publicOrder(order: DemoOrder) {
  return {
    reference: order.reference,
    groupId: order.groupId,
    offerId: order.offerId,
    buyerId: order.buyerId,
    sellerName: order.sellerName,
    strategyLabel: order.strategyLabel,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    paypalOrderId: order.paypalOrderId,
    captureId: order.captureId,
    createdAt: order.createdAt,
    capturedAt: order.capturedAt,
  };
}

export type PublicOrder = ReturnType<typeof publicOrder>;
