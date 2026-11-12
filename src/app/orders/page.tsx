"use client";

/**
 * /orders — the order vault: traceable history of this session's sandbox
 * checkouts, read from the server's `data/orders.json` store (local demo
 * persistence — survives reloads, not deployments; documented honestly).
 *
 * The history renders as an **AG Grid** ledger — sortable columns, a funnel
 * filter on every column and a quick search across the whole row — laid on
 * the same deep-espresso panel the TopNav uses, so a dark ledger sits on the
 * warm paper page. Pending `created` orders stay clearly distinct from
 * VERIFIED captures, and every verified capture shows its internal reference
 * + PayPal capture id. Nothing secret appears here — secrets never leave the
 * server routes.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
  type ColDef,
  type GetRowIdParams,
  type ICellRendererParams,
  type ModelUpdatedEvent,
} from "ag-grid-community";
import { TopNav } from "@/components/TopNav";
import { DemoBadge } from "@/components/ui/atoms";
import { formatMoney } from "@/data/demo";

/* AG Grid v33+ ships features as separately registered modules; the
   community package is enough for sorting, filtering and quick search. */
ModuleRegistry.registerModules([AllCommunityModule]);

interface OrderRecord {
  reference: string;
  groupId: string;
  offerId: string;
  buyerId: string;
  sellerName: string;
  strategyLabel: string;
  amount: string;
  currency: string;
  status: "created" | "captured" | "cancelled" | "failed";
  paypalOrderId: string | null;
  captureId: string | null;
  createdAt: string;
  capturedAt: string | null;
}

/**
 * One short badge word per state (the cell keeps it readable at table
 * width), the honest full sentence for the badge tooltip, and a lifecycle
 * rank so sorting a status column follows checkout order, not the alphabet.
 */
const STATUS: Record<OrderRecord["status"], { label: string; detail: string; rank: number }> = {
  created: { label: "Pending", detail: "Pending — awaiting PayPal approval", rank: 0 },
  captured: { label: "Paid", detail: "Paid — capture verified server-side", rank: 1 },
  cancelled: { label: "Cancelled", detail: "Cancelled — unpaid", rank: 2 },
  failed: { label: "Failed", detail: "Failed — no purchase recorded", rank: 3 },
};

/**
 * The grid's dark theme.
 *
 * Every value is a `globals.css` design token (or two tokens mixed), passed
 * straight through to AG Grid's CSS custom properties — so the ledger can
 * only ever wear this app's own palette, never AG Grid's stock colours.
 * `colorSchemeDark` flips the grid's chrome (menus, popups, native
 * scrollbars) onto the dark side before the tokens are applied.
 */
const ordersTheme = themeQuartz
  .withPart(colorSchemeDark)
  .withParams({
    /* Surfaces — the espresso the TopNav sits on, with just enough ivory
       mixed into the header band to read as a separate ledger heading. */
    backgroundColor: "var(--color-ink-950)",
    dataBackgroundColor: "var(--color-ink-950)",
    wrapperBackgroundColor: "var(--color-ink-950)",
    chromeBackgroundColor: "color-mix(in srgb, var(--color-ink-950) 94%, var(--color-ivory-50))",
    headerBackgroundColor: "color-mix(in srgb, var(--color-ink-950) 96%, var(--color-ivory-50))",

    /* Text — ivory from the inverted-panel palette, muted for sub-lines */
    foregroundColor: "var(--color-ivory-50)",
    subtleTextColor: "var(--color-ivory-mute)",
    headerTextColor: "var(--color-ivory-300)",

    /* Hairlines — the same ivory, kept faint so the rules don't shout */
    borderColor: "color-mix(in srgb, var(--color-ivory-50) 14%, transparent)",
    headerRowBorder: "solid 1px color-mix(in srgb, var(--color-ivory-50) 16%, transparent)",
    rowBorder: "solid 1px color-mix(in srgb, var(--color-ivory-50) 7%, transparent)",
    columnBorder: "solid 1px color-mix(in srgb, var(--color-ivory-50) 7%, transparent)",

    /* Coral is the brand action colour: selection, focus, sort handle */
    accentColor: "var(--color-coral-500)",
    selectedRowBackgroundColor: "color-mix(in srgb, var(--color-coral-500) 26%, var(--color-ink-950))",
    rowHoverColor: "color-mix(in srgb, var(--color-ivory-50) 8%, var(--color-ink-950))",
    headerCellHoverBackgroundColor: "color-mix(in srgb, var(--color-ivory-50) 10%, var(--color-ink-950))",

    /* Filter / column-menu fields stay on the dark surface, focus in coral */
    inputBackgroundColor: "color-mix(in srgb, var(--color-ink-950) 88%, var(--color-ivory-50))",
    inputTextColor: "var(--color-ivory-50)",
    inputPlaceholderTextColor: "var(--color-ivory-mute)",
    inputBorder: "solid 1px color-mix(in srgb, var(--color-ivory-50) 22%, transparent)",
    inputFocusBorder: "solid 1px var(--color-coral-500)",
    inputFocusShadow: "0 0 0 3px color-mix(in srgb, var(--color-coral-500) 32%, transparent)",
    pickerListBackgroundColor: "var(--color-ink-950)",
    pickerListBorder: "solid 1px color-mix(in srgb, var(--color-ivory-50) 18%, transparent)",

    /* The app's own mono voice, set as data so it reaches every cell and
       every popup the grid opens. */
    fontFamily: "var(--font-mono)",
    cellFontFamily: "var(--font-mono)",
    headerFontFamily: "var(--font-mono)",
    cellFontSize: 12,
    headerFontSize: 11,
    rowHeight: 46,
    wrapperBorder: "none",
    wrapperBorderRadius: 12,
  });

/* Module scope keeps every prop identity stable across renders — AG Grid
   treats `getRowId` as an initial-only option, so it must not be seen to
   change after the grid is created. */
const getRowId = (p: GetRowIdParams<OrderRecord>) => p.data.reference;

const DEFAULT_COL_DEF: ColDef<OrderRecord> = {
  sortable: true,
  filter: true,
  resizable: true,
};

const StatusCell = (params: ICellRendererParams<OrderRecord>) => {
  const status = params.data?.status;
  if (!status || !STATUS[status]) return null;
  const s = STATUS[status];
  return (
    <span className={`order-status order-status--${status}`} title={s.detail}>
      {s.label}
    </span>
  );
};

const CaptureCell = (params: ICellRendererParams<OrderRecord>) => {
  const id = params.value == null ? "" : String(params.value);
  if (!id) return <span className="text-ivory-mute">—</span>;
  return (
    <span className="text-ivory-mute" title={id}>
      …{id.slice(-8)}
    </span>
  );
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});

  const refreshOrders = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as { orders: OrderRecord[] };
      setOrders(payload.orders);
    } catch {
      setError("could not reach the order store on the server");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/orders", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as { orders: OrderRecord[] };
        if (!cancelled) setOrders(payload.orders);
      } catch {
        if (!cancelled) setError("could not reach the order store on the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function cancelOrder(reference: string) {
    setActionBusy((current) => ({ ...current, [reference]: true }));
    try {
      const res = await fetch(`/api/orders/${reference}/cancel`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void refreshOrders();
    } catch {
      setError(`Could not cancel order ${reference}.`);
    } finally {
      setActionBusy((current) => {
        const next = { ...current };
        delete next[reference];
        return next;
      });
    }
  }

  async function retryOrder(reference: string) {
    setActionBusy((current) => ({ ...current, [reference]: true }));
    try {
      // Retrying a pending/failed order means re-preparing: cancel the stale
      // checkout then navigate to PayPilot to prepare a fresh confirmation.
      const res = await fetch(`/api/orders/${reference}/cancel`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void refreshOrders();
    } catch {
      setError(`Could not retry order ${reference}.`);
    } finally {
      setActionBusy((current) => {
        const next = { ...current };
        delete next[reference];
        return next;
      });
    }
  }

  /* Reflects whatever survives quick search + per-column filters. */
  const handleModelUpdated = useCallback((e: ModelUpdatedEvent<OrderRecord>) => {
    setVisible(e.api.getDisplayedRowCount());
  }, []);

  /* Action cell renderer — closes over component state so cancel/retry work. */
  const ActionCell = (params: ICellRendererParams<OrderRecord>) => {
    const data = params.data;
    if (!data) return null;
    const { reference, status } = data;
    const busy = actionBusy[reference] === true;
    const pending = status === "created";
    const failed = status === "failed";

    return (
      <div className="flex gap-1">
        {pending && (
          <button
            type="button"
            onClick={() => void cancelOrder(reference)}
            disabled={busy}
            className="rounded-full border border-coral-500/60 bg-coral-500/5 px-2.5 py-1 text-[10px] text-coral-600 transition-colors hover:bg-coral-500 hover:text-ink-950 disabled:opacity-50 disabled:cursor-wait"
            title="Cancel this pending checkout — it stays unpaid"
          >
            {busy ? "…" : "Cancel"}
          </button>
        )}
        {(pending || failed) && (
          <button
            type="button"
            onClick={() => void retryOrder(reference)}
            disabled={busy}
            className="rounded-full border border-ink-600 bg-ink-850 px-2.5 py-1 text-[10px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100 disabled:opacity-50 disabled:cursor-wait"
            title="Cancel this checkout and prepare a fresh confirmation in PayPilot"
          >
            {busy ? "…" : "Retry"}
          </button>
        )}
      </div>
    );
  };

  const columnDefs = useMemo<ColDef<OrderRecord>[]>(
    () => [
      {
        field: "reference",
        headerName: "Reference",
        minWidth: 150,
        flex: 1,
        filter: "agTextColumnFilter",
        cellClass: "font-medium",
      },
      {
        field: "buyerId",
        headerName: "Buyer",
        width: 76,
        filter: "agTextColumnFilter",
      },
      {
        field: "sellerName",
        headerName: "Seller",
        minWidth: 176,
        flex: 1,
        filter: "agTextColumnFilter",
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 118,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        valueGetter: (p) => Number(p.data?.amount ?? 0),
        valueFormatter: (p) => formatMoney(Number(p.value)),
        getQuickFilterText: (p) => `${formatMoney(Number(p.value))} ${p.data?.currency ?? ""}`,
        cellClass: "tnum",
      },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => (p.data ? STATUS[p.data.status].label : ""),
        /* filters match the human label ("Paid", "Pending"), not the raw enum */
        filterValueGetter: (p) => (p.data ? STATUS[p.data.status].label : ""),
        getQuickFilterText: (p) => (p.data ? STATUS[p.data.status].label : ""),
        cellRenderer: StatusCell,
        comparator: (a, b) =>
          (STATUS[String(a) as OrderRecord["status"]]?.rank ?? 0) -
          (STATUS[String(b) as OrderRecord["status"]]?.rank ?? 0),
      },
      {
        field: "captureId",
        headerName: "Capture id",
        width: 118,
        filter: "agTextColumnFilter",
        valueFormatter: (p) => (p.value ? `…${String(p.value).slice(-8)}` : "—"),
        cellRenderer: CaptureCell,
      },
      {
        field: "createdAt",
        headerName: "Created",
        width: 176,
        filter: "agDateColumnFilter",
        sort: "desc",
        valueGetter: (p) => (p.data ? new Date(p.data.createdAt) : null),
        valueFormatter: (p) => (p.value instanceof Date ? p.value.toLocaleString("en-GB") : ""),
        getQuickFilterText: (p) => (p.value instanceof Date ? p.value.toLocaleString("en-GB") : ""),
        comparator: (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() - b.getTime() : 0),
      },
      {
        field: "actions" as unknown as keyof OrderRecord,
        headerName: "Actions",
        width: 150,
        sortable: false,
        filter: false,
        cellRenderer: ActionCell,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="market-grid min-h-screen bg-ink-900">
      <TopNav />
      <main className="mx-auto max-w-[1000px] px-4 pb-24 pt-28 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <p className="tick text-coral-600">ORDER HISTORY</p>
            <DemoBadge />
          </div>
          <button
            type="button"
            onClick={refreshOrders}
            disabled={refreshing}
            className="rounded-full border border-ink-600 px-3 py-1.5 text-[11px] text-fog-400 transition-colors hover:border-fog-400 hover:text-fog-100 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh ledger"}
          </button>
        </div>
        <h1 className="mt-2 font-print text-4xl font-semibold tracking-tight text-fog-100 sm:text-5xl">Your orders</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog-400">
          Every checkout attempt is recorded on the server. Orders waiting for PayPal approval
          stay clearly marked unpaid, and only orders whose PayPal capture the server verified are
          marked paid. Amounts are the engine&apos;s own computed shares (EUR) — the browser never
          set a price.
        </p>

        {orders == null && !error && (
          <p className="mt-10 font-mono text-sm text-fog-400" role="status">
            Reading the order store…
          </p>
        )}
        {error && <p className="mt-10 rounded-lg border border-coral-500/40 p-4 text-xs text-coral-600">△ {error}</p>}

        {orders != null && orders.length > 0 && <OrderAnalytics orders={orders} />}

        {orders != null && (
          <section aria-label="Order history" className="mt-10">
            {orders.length === 0 ? (
              <div className="grid place-items-center rounded-xl border border-dashed border-ink-500 bg-ink-850 p-10 text-center">
                <p className="max-w-[42ch] text-sm leading-relaxed text-fog-400">
                  No checkouts yet. Pick an eligible offer on the{" "}
                  <Link href="/market" className="text-coral-600 underline-offset-4 hover:underline">
                    market page
                  </Link>{" "}
                  and complete a PayPal Sandbox payment.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="tick text-fog-500">
                      ORDER LEDGER · {orders.length} RECORD{orders.length === 1 ? "" : "S"}
                    </p>
                    <p className="mt-1 text-xs text-fog-500">
                      Click a column header to sort · hover a header for its filter funnel.
                    </p>
                  </div>
                  <label className="w-full sm:w-80">
                    <span className="sr-only">Search orders</span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search reference, buyer, status…"
                      className="w-full rounded-full border border-ink-600 bg-ink-850 px-4 py-2 font-mono text-xs text-fog-100 outline-none transition-colors placeholder:text-fog-500 focus:border-coral-500"
                    />
                  </label>
                </div>

                <div className="ag-order-ledger mt-4 rounded-xl border border-white/10 bg-ink-950 shadow-lg">
                  <div className="h-[440px] sm:h-[560px]">
                    <AgGridReact<OrderRecord>
                      rowData={orders}
                      columnDefs={columnDefs}
                      defaultColDef={DEFAULT_COL_DEF}
                      theme={ordersTheme}
                      getRowId={getRowId}
                      quickFilterText={query}
                      onModelUpdated={handleModelUpdated}
                      enableCellTextSelection
                      loadThemeGoogleFonts={false}
                    />
                  </div>
                </div>

                <p className="tick mt-3 text-fog-500" role="status">
                  SHOWING {visible ?? orders.length} OF {orders.length} ORDER{orders.length === 1 ? "" : "S"}
                </p>
              </>
            )}
          </section>
        )}

        <p className="mt-10 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-400">
          LOCAL DEMO DATA · Orders live in the server&apos;s local data file — they survive a
          restart of this machine but are not deployed persistence. PayPal Sandbox captures are
          payment simulations against test accounts: no real goods, no escrow, no group settlement.
        </p>
      </main>
    </div>
  );
}

/**
 * Deterministic analytics over the server's order records.
 *
 * No model output, no estimated revenue and no fabricated trend: every number
 * is a count or a sum of amounts the server already verified. Only captured
 * orders contribute to volume; pending/cancelled/failed never do.
 */
function OrderAnalytics({ orders }: { orders: OrderRecord[] }) {
  const summary = useMemo(() => {
    const captured = orders.filter((o) => o.status === "captured");
    const pending = orders.filter((o) => o.status === "created");
    const unpaid = orders.filter((o) => o.status === "cancelled" || o.status === "failed");
    const volume = captured.reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const conversion = orders.length > 0 ? Math.round((captured.length / orders.length) * 100) : 0;
    // Seven local calendar days ending today; capturedAt is the verified time.
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
      return {
        key: localDayKey(date),
        label: date.toLocaleDateString("en-GB", { weekday: "short" }),
        total: 0,
        count: 0,
      };
    });
    const byKey = new Map(days.map((day) => [day.key, day]));
    for (const order of captured) {
      if (!order.capturedAt) continue;
      const date = new Date(order.capturedAt);
      if (Number.isNaN(date.getTime())) continue;
      const bucket = byKey.get(localDayKey(date));
      if (!bucket) continue;
      bucket.total += Number(order.amount || 0);
      bucket.count += 1;
    }
    return { captured: captured.length, pending: pending.length, unpaid: unpaid.length, volume, conversion, days };
  }, [orders]);

  const max = Math.max(1, ...summary.days.map((day) => day.total));
  const chartLabel = summary.days
    .map((day) => `${day.label}: ${formatMoney(day.total)} across ${day.count} verified capture${day.count === 1 ? "" : "s"}`)
    .join("; ");

  return (
    <section aria-label="Order analytics" className="mt-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Analytic label="Verified volume" value={formatMoney(summary.volume)} note="captured orders only" accent />
        <Analytic label="Paid orders" value={String(summary.captured)} note={`${summary.conversion}% of attempts`} />
        <Analytic label="Awaiting approval" value={String(summary.pending)} note="no money captured" />
        <Analytic label="Cancelled / failed" value={String(summary.unpaid)} note="never counted as paid" />
      </div>

      <div className="mt-3 rounded-xl border border-ink-600 bg-ink-850 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-fog-100">Verified capture volume · last 7 days</h2>
          <p className="tick text-fog-500">EUR · server-verified captures only</p>
        </div>
        <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label={chartLabel}>
          {summary.days.map((day) => (
            <div key={day.key} className="flex h-full flex-1 flex-col gap-1.5" title={`${day.label}: ${formatMoney(day.total)} · ${day.count} capture${day.count === 1 ? "" : "s"}`}>
              <div className="flex flex-1 items-end">
                <div
                  className={`w-full rounded-t-sm ${day.total > 0 ? "bg-coral-500" : "bg-ink-600"}`}
                  style={{ height: `${day.total > 0 ? Math.max(8, (day.total / max) * 100) : 4}%` }}
                />
              </div>
              <span className="text-center font-mono text-[10px] text-fog-500">{day.label}</span>
            </div>
          ))}
        </div>
        {summary.captured === 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-fog-500">
            No verified captures in this window yet — bars stay empty rather than showing an invented trend.
          </p>
        )}
      </div>
    </section>
  );
}

function Analytic({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-850 p-4">
      <p className="tick text-fog-500">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold leading-none ${accent ? "text-coral-600" : "text-fog-100"}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-fog-500">{note}</p>
    </div>
  );
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
