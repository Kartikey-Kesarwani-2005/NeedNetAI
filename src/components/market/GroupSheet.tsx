"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_BY_ID, QUALITY_LABEL, formatMoney } from "@/data/demo";
import { buildGroupFacts } from "@/ai/facts";
import type { ExplanationResponse, GroupFacts } from "@/ai/types";
import { deterministicExplanation, type ValidatedExplanation } from "@/ai/validate";
import type { ComputedGroup } from "@/engine/engine";
import { useMarket } from "@/state/store";
import type { AgentAdviceResponse } from "@/app/api/agent/purchase/route";
import { AvailabilityChip, CompatibilityChip, EnginePickChip, PurchasedChip, QualityChip, RankChip, TrustChip } from "./chips";

interface GroupSheetProps {
  groupId: string;
  onClose: () => void;
  /** Opens the full offer review modal (Phase 4 checkout surface). */
  onReviewOffer?: (offerId: string) => void;
}

/**
 * Demand group detail — a right-hand sheet over the market.
 * Every number and reason comes from the matching engine's computed
 * group record and generated simulated offers.
 */
export function GroupSheet({ groupId, onClose, onReviewOffer }: GroupSheetProps) {
  const { state, select, withdraw } = useMarket();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const g = state.computed.groups.find((x) => x.id === groupId);

  if (!g) {
    return (
      <SheetFrame onClose={onClose} closeRef={closeRef}>
        <p className="p-8 font-mono text-xs text-fog-400">
          Cluster dissolved by the engine or record missing — the market has recalculated. Close this sheet and select another group.
        </p>
      </SheetFrame>
    );
  }

  const cat = CATEGORY_BY_ID[g.categoryId];
  const m = g.metrics;
  const offers = state.computed.offers.filter((o) => o.groupId === g.id);
  const excluded = state.computed.excludedOffers.filter((x) => x.groupId === g.id);

  return (
    <SheetFrame onClose={onClose} closeRef={closeRef}>
      <span className="tick" style={{ color: cat.color }}>
        {cat.label.toUpperCase()} · {g.seed ? "SEEDED COMMUNITY, RE-VALIDATED" : "FORMED BY THE ENGINE"}
      </span>
      <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-fog-100">{g.name}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <CompatibilityChip kind={m.compatibility} />
        <span className="tick rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-amber-400">Demo data</span>
        <span className="tick rounded-full border border-ink-600 px-2 py-0.5 text-fog-300">alignment score {m.avgPairScore.toFixed(2)}</span>
      </div>

      <Block title="What this group wants">
        <p className="text-sm leading-relaxed text-fog-300">{g.objective}</p>
        <p className="mt-3 rounded-lg border-l-4 border-coral-500/60 bg-ink-800/60 p-3 pl-4 text-[13px] leading-relaxed text-fog-400">{g.rationale}</p>
      </Block>

      <Block title="Why these buyers were joined">
        <ul className="space-y-1.5">
          {m.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] leading-snug text-fog-300">
              <span className="shrink-0 font-semibold text-cyan-400">+</span>
              {r}
            </li>
          ))}
          {m.reasons.length === 0 && (
            <li className="text-[12px] text-fog-500">Not enough solid overlap yet — this group may regroup on the next update.</li>
          )}
        </ul>
      </Block>

      <ExplainDecisionBlock groupId={g.id} />

      <AgentAdviceBlock group={g} onCloseSheet={onClose} onReviewOffer={onReviewOffer} />

      <Block title={`Group members (${m.memberCount})`}>
        <ul className="space-y-3">
          {g.members.map((mem) => (
            <li key={mem.id} className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-fog-100">{mem.label}</span>
                <span className="tick text-fog-500">{QUALITY_LABEL[mem.quality]}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-fog-300">{mem.need}</p>
              <p className="mt-1.5 text-[12px] text-fog-500">
                {formatMoney(mem.budgetMin)}–{formatMoney(mem.budgetMax)} budget · ×{mem.quantity} · {mem.deadlineDays} days · {mem.location ?? "any location"}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="tick text-coral-500 transition-colors hover:text-coral-400"
                  onClick={() => {
                    onClose();
                    select({ kind: "buyer", id: mem.id });
                  }}
                >
                  Inspect in network →
                </button>
                <button
                  type="button"
                  className="tick text-fog-500 underline offset-2 transition-colors hover:text-coral-500"
                  onClick={() => withdraw(mem.id)}
                  title="Removes this demo buyer and immediately recalculates the group"
                >
                  Withdraw & recompute
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Group numbers at a glance">
        <dl className="divide-y divide-ink-700 rounded-lg border border-ink-600 bg-ink-850">
          <MetricRow k="Total requested units" v={String(m.totalUnits)} />
          <MetricRow
            k="Combined stated budgets"
            v={`${formatMoney(m.combinedBudgetMin)}–${formatMoney(m.combinedBudgetMax)}`}
            note="sum of individual ceilings — not guaranteed purchasing power"
          />
          <MetricRow k="Per-unit budget range" v={`€${Math.round(m.unitBudgetMin)}–€${Math.round(m.unitBudgetMax)} per unit`} />
          <MetricRow k="Delivery window spread" v={`${m.earliestDeadlineDays}d – ${m.latestDeadlineDays}d`} />
          <MetricRow k="Compatibility score" v={`${m.avgPairScore.toFixed(2)} avg · ${m.minPairScore.toFixed(2)} min pair`} />
          <MetricRow k="Shared product terms" v={m.sharedTokens.length > 0 ? m.sharedTokens.join(", ") : "no strong shared vocabulary"} />
          {m.memberConstraints.length > 0 && (
            <MetricRow k="Declared constraints" v={m.memberConstraints.map((c) => `“${c}”`).join(" · ")} />
          )}
        </dl>
      </Block>

      <Block title={`Offers competing for this group (${offers.length})`}>
        {offers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-500 p-4 text-xs leading-relaxed text-fog-500">
            No seller strategy can currently serve this group. {excluded.length > 0 && `Reasons: ${excluded.map((x) => `${x.sellerName} — ${x.reasons[0]}`).join("; ")}.`}
          </p>
        ) : (
          <ul className="space-y-3">
            {offers.map((o) => (
              <li key={o.id} className="rounded-lg border border-ink-600 bg-ink-850 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-fog-100">{o.sellerName}</span>
                  <span className="text-xs font-semibold text-cyan-400">
                    {formatMoney(o.unitPrice)}/unit · lot {formatMoney(o.lotTotal)}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-fog-500">
                  {o.strategyLabel} strategy · {o.deliveryDays} days delivery · grade {o.quality}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {o.recommended ? <EnginePickChip score={o.score} /> : <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-400">runner-up</span>}
                  <PurchasedChip offerId={o.id} />
                  <RankChip label="price" rank={o.priceRank} />
                  <RankChip label="speed" rank={o.speedRank} />
                  <QualityChip quality={o.quality} />
                  <AvailabilityChip availability={o.availability} />
                </div>
                <ul className="mt-2 space-y-1">
                  {o.facts.slice(0, 3).map((f) => (
                    <li key={f} className="font-mono text-[10px] leading-snug text-fog-400">· {f}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="tick mt-2 rounded-full bg-coral-500 px-3 py-1.5 text-ink-950 transition-colors hover:bg-coral-400"
                  onClick={() => {
                    onClose();
                    select({ kind: "offer", id: o.id });
                    onReviewOffer?.(o.id);
                  }}
                >
                  Review offer →
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {excluded.length > 0 && (
        <Block title={`Sellers who could not quote (${excluded.length})`}>
          <ul className="space-y-2">
            {excluded.map((x) => (
              <li key={x.sellerId} className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-fog-300">{x.sellerName}</span>
                  <span className="tick text-amber-400">{x.strategyLabel}</span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {x.reasons.map((r) => (
                    <li key={r} className="text-[12px] leading-snug text-fog-500">× {r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </SheetFrame>
  );
}

/**
 * Phase 3 decision explanation.
 *
 * Layer 1 (always): deterministic explanation derived from the engine's own
 * computed facts — labelled ENGINE.
 * Layer 2 (optional): an AI narrative over the same facts, POSTed to the
 * server route where it is validated against the identical facts. If the
 * model call fails or the story fails validation, we say so truthfully and
 * the deterministic layer stands.
 */
function ExplainDecisionBlock({ groupId }: { groupId: string }) {
  const { state } = useMarket();
  const group = state.computed.groups.find((g) => g.id === groupId);

  const [shown, setShown] = useState<ValidatedExplanation | null>(null);
  const [aiState, setAiState] = useState<"idle" | "loading" | "ok" | "unavailable" | "error" | "stale-reset">("idle");
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<ValidatedExplanation | null>(null);

  // Reset on group change — never mix another group's narrative in.
  useEffect(() => {
    setShown(null);
    setAiState("idle");
    setAiMessage(null);
    setNarrative(null);
  }, [groupId]);

  const showDeterministic = () => {
    if (!group) return;
    const facts = buildGroupFacts(state.computed, groupId);
    if (!facts) return;
    setShown(deterministicExplanation(facts));
  };

  const askAi = async () => {
    if (!group) return;
    const facts: GroupFacts | null = buildGroupFacts(state.computed, groupId);
    if (!facts) return;
    setAiState("loading");
    setAiMessage(null);
    setNarrative(null);
    const snapshotToken = state.lastChange?.token ?? 0;
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });
      // Stale-response guard: if a live update happened while waiting, the
      // narration no longer describes the current market — drop it.
      if ((state.lastChange?.token ?? 0) !== snapshotToken) {
        setAiState("stale-reset");
        setAiMessage("The market changed while the narrator waited — request discarded. Ask again for the current facts.");
        return;
      }
      const payload = (await response.json()) as ExplanationResponse;
      if (payload.ok && payload.source === "ai" && payload.explanation) {
        setAiState("ok");
        setNarrative({
          summary: payload.explanation.summary,
          tradeoffs: payload.explanation.tradeoffs,
          evidenceOfferIds: payload.explanation.evidenceOfferIds,
        });
      } else if (payload.status === "unavailable") {
        setAiState("unavailable");
        setAiMessage("No AI credentials are configured on this server, so no model was called. The deterministic explanation remains authoritative.");
      } else {
        setAiState("error");
        setAiMessage(payload.reason ?? "The AI explanation failed validation against engine facts and was discarded. The deterministic explanation is shown instead.");
      }
    } catch {
      setAiState("error");
      setAiMessage("The explanation request failed (network or server error). Nothing was shown as AI output. The deterministic explanation remains available.");
    }
  };

  if (!group) return null;

  return (
    <Block title="Explain this decision">
      <div className="flex flex-wrap gap-2">
        {!shown && (
          <button
            type="button"
            onClick={showDeterministic}
            className="tick border border-sage-400/60 px-3 py-1.5 text-sage-400 transition-colors hover:bg-sage-400/10"
          >
            Explain decision (engine)
          </button>
        )}
        <button
          type="button"
          onClick={askAi}
          disabled={aiState === "loading"}
          className="tick border border-lilac-400/50 px-3 py-1.5 text-lilac-300 transition-colors hover:bg-lilac-400/10 disabled:opacity-50"
        >
          {aiState === "loading" ? "Asking AI…" : "Narrate with AI (optional)"}
        </button>
      </div>

      {shown && (
        <div className="rise-in mt-3 border border-ink-700 p-3">
          <div className="flex items-center gap-2">
            <TrustChip origin="engine" />
            <span className="tick text-fog-500">deterministic explanation, valid without AI</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fog-300">{shown.summary}</p>
          {shown.tradeoffs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {shown.tradeoffs.map((t) => (
                <li key={t} className="flex gap-2 text-[13px] leading-snug text-fog-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 bg-amber-400" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {narrative && (
        <div className="rise-in mt-3 border border-lilac-400/40 p-3">
          <div className="flex items-center gap-2">
            <TrustChip origin="ai" />
            <span className="tick text-fog-500">AI narrative over engine facts — validated against every id and amount</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fog-300">{narrative.summary}</p>
          {narrative.tradeoffs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {narrative.tradeoffs.map((t) => (
                <li key={t} className="flex gap-2 text-[13px] leading-snug text-fog-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 bg-lilac-400" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          )}
          <p className="tick mt-2 text-fog-500">All offers are simulated strategy quotes — the AI does not confirm real vendors.</p>
        </div>
      )}

      {(aiState === "unavailable" || aiState === "error" || aiState === "stale-reset") && aiMessage && (
        <p className="tick mt-3 border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-amber-300" role="status">
          <span aria-hidden>{"//"}</span> {aiState === "unavailable" ? "AI unavailable — " : aiState === "stale-reset" ? "Stale response — " : ""}
          {aiMessage}
        </p>
      )}

      {!shown && aiState !== "loading" && (
        <p className="tick mt-2 text-fog-500">The deterministic explanation is always available and needs no AI service.</p>
      )}
    </Block>
  );
}

/**
 * Agentic checkout block (Phase 4): an AI purchasing agent that CHOOSES from
 * the engine's own computed candidates — it can never price, never invent,
 * and never pay. The human approves in the PayPal popup; the server verifies
 * the capture. Without AI credentials, the deterministic engine makes the
 * pick and the response is truthfully labelled.
 */
function AgentAdviceBlock({
  group,
  onCloseSheet,
  onReviewOffer,
}: {
  group: ComputedGroup;
  onCloseSheet: () => void;
  onReviewOffer?: (offerId: string) => void;
}) {
  const { state, agentProposed } = useMarket();
  const [actingBuyerId, setActingBuyerId] = useState<string>(group.members[0]?.id ?? "");
  const [state_, setState_] = useState<"idle" | "running" | "done" | "error">("idle");
  const [advice, setAdvice] = useState<AgentAdviceResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset when the group (or its member list) changes behind the sheet.
  useEffect(() => {
    setState_("idle");
    setAdvice(null);
    setErrorMsg(null);
    setActingBuyerId(group.members[0]?.id ?? "");
  }, [group.id, group.members.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (actingBuyerId === "") return;
    setState_("running");
    setErrorMsg(null);
    setAdvice(null);
    try {
      const res = await fetch("/api/agent/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerId: actingBuyerId, buyers: state.buyers }),
      });
      const payload = (await res.json()) as AgentAdviceResponse;
      if (!res.ok || !payload.offer) {
        setState_("error");
        setErrorMsg(payload.error ?? "the agent could not run — check the server logs");
        return;
      }
      setAdvice(payload);
      setState_("done");
      const actor = group.members.find((mm) => mm.id === payload.buyer.buyerId);
      agentProposed({
        runId: payload.runId,
        buyerId: payload.buyer.buyerId,
        buyerLabel: actor?.label ?? payload.buyer.buyerId,
        offerId: payload.offer.offerId,
        offerTitle: `${payload.offer.offerId} · ${payload.offer.sellerName}`,
        approach: payload.source,
      });
    } catch {
      setState_("error");
      setErrorMsg("network error while running the agent — nothing was proposed");
    }
  };

  const chosenCost = advice ? group.members.find((mm) => mm.id === advice.buyer.buyerId) : undefined;

  return (
    <Block title="✦ AI purchasing agent">
      <p className="mb-3 text-[12px] leading-relaxed text-fog-500">
        The agent can only <b className="text-lilac-400">choose</b> among the engine&apos;s computed
        offers — it cannot set prices, invent anything, or pay. You approve the payment yourself in
        the PayPal Sandbox popup.
      </p>
      <div className="mb-3 grid gap-1.5">
        {group.members.map((mm) => (
          <label
            key={mm.id}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors ${
              actingBuyerId === mm.id ? "border-lilac-300 bg-lilac-300/5 text-fog-100" : "border-ink-600 text-fog-400 hover:border-ink-500"
            }`}
          >
            <input
              type="radio"
              name="agent-buyer"
              value={mm.id}
              checked={actingBuyerId === mm.id}
              onChange={() => setActingBuyerId(mm.id)}
              className="accent-lilac-300"
            />
            <span className="text-[13px]">{mm.label}</span>
            <span className="ml-auto text-[11px] text-fog-500">×{mm.quantity} · {mm.deadlineDays} days</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={actingBuyerId === "" || state_ === "running"}
        className="tick w-full rounded-full border border-lilac-300/60 bg-lilac-300/10 px-3 py-2.5 text-lilac-400 transition-colors hover:bg-lilac-300/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state_ === "running" ? "Agent deciding…" : "✦ Run the purchasing agent"}
      </button>

      {state_ === "error" && <p className="mt-2 text-[12px] text-amber-400">△ {errorMsg}</p>}

      {state_ === "done" && advice && (
        <div className="mt-3 rounded-xl border border-lilac-300/50 bg-lilac-300/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tick rounded-full border border-lilac-300/60 bg-lilac-300/10 px-2 py-0.5 text-lilac-400">
              {advice.source === "ai" ? "AI AGENT&apos;S CHOICE" : "ENGINE AGENT (no AI on server)"}
            </span>
            <span className="tick text-fog-500">run {advice.runId}</span>
          </div>
          <p className="mt-2 font-display text-base font-semibold leading-snug text-fog-100">{advice.headline}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-fog-300">{advice.reasoning}</p>
          <p className="mt-2 text-[12px] text-fog-500">
            for {chosenCost?.label ?? advice.buyer.buyerId} · server-computed share {formatMoney(Number(advice.amount))} EUR —
            the browser cannot change this price
          </p>
          {advice.message && <p className="mt-1.5 text-[12px] leading-relaxed text-amber-400">△ {advice.message}</p>}
          <button
            type="button"
            onClick={() => {
              onCloseSheet();
              onReviewOffer?.(advice.offer.offerId);
            }}
            className="tick mt-3 w-full rounded-full bg-coral-500 px-3 py-2.5 text-ink-950 transition-colors hover:bg-coral-400"
          >
            Review & pay this proposal →
          </button>
        </div>
      )}
    </Block>
  );
}

function MetricRow({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-xs text-fog-500">{k}</dt>
        <dd className="text-right text-[13px] font-medium text-fog-100">{v}</dd>
      </div>
      {note && <p className="mt-0.5 text-right text-[10px] text-fog-500">{note}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 border-t border-ink-600 pt-4">
      <h3 className="mb-3 font-display text-[15px] font-semibold text-fog-100">{title}</h3>
      {children}
    </section>
  );
}

function SheetFrame({
  onClose,
  closeRef,
  children,
}: {
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Demand group detail">
      <button type="button" className="scrim-in absolute inset-0 bg-ink-950/50" onClick={onClose} aria-label="Close group detail" />
      <aside className="sheet-in absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto bg-ink-900 p-6 shadow-2xl sm:p-8">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="tick absolute right-5 top-5 rounded-full border border-ink-600 px-3 py-1.5 text-fog-400 transition-colors hover:border-ink-500 hover:text-fog-100"
        >
          Close ✕
        </button>
        <div className="pr-16">{children}</div>
      </aside>
    </div>
  );
}
