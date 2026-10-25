"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_BY_ID, QUALITY_LABEL, formatMoney } from "@/data/demo";
import { buildGroupFacts } from "@/ai/facts";
import type { ExplanationResponse, GroupFacts } from "@/ai/types";
import { deterministicExplanation, type ValidatedExplanation } from "@/ai/validate";
import { useMarket } from "@/state/store";
import { AvailabilityChip, CompatibilityChip, EnginePickChip, QualityChip, RankChip, TrustChip } from "./chips";

interface GroupSheetProps {
  groupId: string;
  onClose: () => void;
}

/**
 * Demand group detail — a right-hand sheet over the market.
 * Every number and reason comes from the matching engine's computed
 * group record and generated simulated offers.
 */
export function GroupSheet({ groupId, onClose }: GroupSheetProps) {
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
        {g.id.toUpperCase()} / {cat.label} {g.seed ? "/ seeded community, re-validated" : "/ engine-formed"}
      </span>
      <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-fog-100">{g.name}</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <CompatibilityChip kind={m.compatibility} />
        <span className="tick border border-coral-500/40 bg-coral-500/5 px-1.5 py-0.5 text-coral-400">Demo data</span>
        <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-300">engine pair score {m.avgPairScore.toFixed(2)}</span>
      </div>

      <Block title="Group objective">
        <p className="text-sm leading-relaxed text-fog-300">{g.objective}</p>
        <p className="mt-3 border-l-2 border-ink-600 pl-3 text-[13px] italic leading-relaxed text-fog-400">{g.rationale}</p>
      </Block>

      <Block title="Why the engine grouped these buyers">
        <ul className="space-y-1.5">
          {m.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] leading-snug text-fog-300">
              <span className="tick shrink-0 text-cyan-400">+</span>
              {r}
            </li>
          ))}
          {m.reasons.length === 0 && (
            <li className="font-mono text-[10px] text-fog-500">Below minimum explainable evidence — group dissolves on next recalculation.</li>
          )}
        </ul>
      </Block>

      <ExplainDecisionBlock groupId={g.id} />

      <Block title={`Anonymized members (${m.memberCount})`}>
        <ul className="space-y-3">
          {g.members.map((mem) => (
            <li key={mem.id} className="border border-ink-700 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs font-medium text-fog-100">{mem.label}</span>
                <span className="tick text-fog-500">{QUALITY_LABEL[mem.quality]}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-fog-300">{mem.need}</p>
              <p className="mt-1.5 font-mono text-[10px] text-fog-500">
                {formatMoney(mem.budgetMin)}–{formatMoney(mem.budgetMax)} · ×{mem.quantity} · {mem.deadlineDays}d · {mem.location ?? "no zone"}
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

      <Block title="Derived group metrics">
        <dl className="divide-y divide-ink-700/60 border border-ink-700">
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

      <Block title={`Eligible simulated offers (${offers.length})`}>
        {offers.length === 0 ? (
          <p className="border border-dashed border-ink-600 p-4 font-mono text-xs leading-relaxed text-fog-500">
            No seller strategy can currently serve this group. {excluded.length > 0 && `Reasons: ${excluded.map((x) => `${x.sellerName} — ${x.reasons[0]}`).join("; ")}.`}
          </p>
        ) : (
          <ul className="space-y-3">
            {offers.map((o) => (
              <li key={o.id} className="border border-ink-700 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-fog-100">{o.sellerName}</span>
                  <span className="font-mono text-xs text-cyan-400">
                    {formatMoney(o.unitPrice)}/unit · lot {formatMoney(o.lotTotal)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-fog-500">
                  {o.strategyLabel} strategy · {o.deliveryDays}d delivery · grade {o.quality}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {o.recommended ? <EnginePickChip score={o.score} /> : <span className="tick border border-ink-600 px-1.5 py-0.5 text-fog-400">runner-up</span>}
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
                  className="tick mt-2 border border-ink-600 px-2 py-1 text-fog-300 transition-colors hover:border-cyan-400 hover:text-cyan-400"
                  onClick={() => {
                    onClose();
                    select({ kind: "offer", id: o.id });
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
        <Block title={`Strategies that could not quote (${excluded.length})`}>
          <ul className="space-y-2">
            {excluded.map((x) => (
              <li key={x.sellerId} className="border border-ink-700 bg-ink-850 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs text-fog-300">{x.sellerName}</span>
                  <span className="tick text-amber-400">{x.strategyLabel}</span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {x.reasons.map((r) => (
                    <li key={r} className="font-mono text-[10px] leading-snug text-fog-500">× {r}</li>
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
          className="tick border border-violet-400/50 px-3 py-1.5 text-violet-300 transition-colors hover:bg-violet-400/10 disabled:opacity-50"
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
          <p className="mt-2 text-sm leading-relaxed text-fog-200">{shown.summary}</p>
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
        <div className="rise-in mt-3 border border-violet-400/40 p-3">
          <div className="flex items-center gap-2">
            <TrustChip origin="ai" />
            <span className="tick text-fog-500">AI narrative over engine facts — validated against every id and amount</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fog-200">{narrative.summary}</p>
          {narrative.tradeoffs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {narrative.tradeoffs.map((t) => (
                <li key={t} className="flex gap-2 text-[13px] leading-snug text-fog-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 bg-violet-400" aria-hidden />
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

function MetricRow({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="tick text-fog-500">{k}</dt>
        <dd className="text-right font-mono text-xs text-fog-100">{v}</dd>
      </div>
      {note && <p className="mt-0.5 text-right font-mono text-[9px] text-fog-500">{note}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 border-t border-ink-700 pt-4">
      <h3 className="tick mb-3 text-fog-500">{title}</h3>
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
      <button type="button" className="scrim-in absolute inset-0 bg-ink-950/70" onClick={onClose} aria-label="Close group detail" />
      <aside className="sheet-in absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-ink-600 bg-ink-900 p-6 sm:p-8">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="tick absolute right-5 top-5 border border-ink-600 px-2 py-1 text-fog-400 transition-colors hover:border-fog-100 hover:text-fog-100"
        >
          Close ✕
        </button>
        <div className="pr-16">{children}</div>
      </aside>
    </div>
  );
}
