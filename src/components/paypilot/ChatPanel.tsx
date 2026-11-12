"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CATEGORY_BY_ID, formatMoney } from "@/data/demo";
import type {
  BudgetSettings,
  ChatReply,
  ProposedBudgetAction,
  PurchasePlan,
} from "@/paypilot/types";
import { ApiError, api } from "./api";
import { Card } from "./ui";

type Source = "ai" | "deterministic";
type AiStatus = "used" | "unavailable" | "error";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: Source;
  aiStatus?: AiStatus;
  notes?: string[];
  plan?: PurchasePlan;
  proposedAction?: ProposedBudgetAction;
  suggestions?: string[];
}

interface ChatResponse extends ChatReply {
  source: Source;
  aiStatus: AiStatus;
}

const SUGGESTIONS = [
  "How much have I spent?",
  "Set my monthly budget to €300",
  "Plan a purchase for B-01",
  "What has the agent done?",
];

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  text: "I can explain verified spending, propose a planning budget, build a purchase plan from the deterministic engine, and prepare a PayPal Sandbox checkout. I cannot approve or capture a payment for you.",
};

export function ChatPanel({
  budget,
  onPlan,
  onPrepare,
  onBudgetSaved,
  onRefresh,
  onResetConversation,
}: {
  budget: BudgetSettings | null;
  onPlan: (plan: PurchasePlan) => void;
  onPrepare: (plan: PurchasePlan, offerId: string) => void;
  onBudgetSaved: (budget: BudgetSettings) => void;
  onRefresh: () => void;
  onResetConversation?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, true>>({});
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const resetConversation = useCallback(async () => {
    if (!onResetConversation) return;
    setResetPending(true);
    setInput("");
    setActionError(null);
    setMessages([WELCOME]);
    setApplied({});
    try {
      await onResetConversation();
    } finally {
      setResetPending(false);
    }
  }, [onResetConversation]);

  const suggestionButtons = (() => {
    const dynamic = messages
      .filter((m) => m.role === "assistant")
      .slice(-3)
      .flatMap((m) => m.suggestions ?? []);
    const list = [...new Set(dynamic.length > 0 ? dynamic : SUGGESTIONS)];
    return list.map((suggestion) => (
      <button
        key={suggestion}
        type="button"
        disabled={busy}
        onClick={() => void send(suggestion)}
        className="rounded-full border border-ink-600 px-2.5 py-1 text-[11px] text-fog-400 transition-colors hover:border-coral-500 hover:text-coral-600 disabled:opacity-50"
      >
        {suggestion}
      </button>
    ));
  })();

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  async function send(raw: string) {
    const message = raw.trim();
    if (message.length === 0 || busy) return;
    const userMessage: Message = { id: `u-${Date.now()}`, role: "user", text: message };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy(true);
    try {
      const reply = await api<ChatResponse>("/api/paypilot/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      const assistant: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: reply.reply,
        source: reply.source,
        aiStatus: reply.aiStatus,
        notes: reply.intent.notes,
        ...(reply.plan ? { plan: reply.plan } : {}),
        ...(reply.proposedAction ? { proposedAction: reply.proposedAction } : {}),
      };
      setMessages((current) => [...current, assistant]);
      if (reply.plan) onPlan(reply.plan);
      onRefresh();
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          text: error instanceof ApiError ? error.message : "The assistant could not be reached. Nothing was changed.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  async function applyBudget(messageId: string, action: ProposedBudgetAction) {
    if (actionBusyId) return;
    setActionBusyId(messageId);
    setActionError(null);

    let monthlyLimit = action.monthlyLimit;
    const categoryLimits = { ...(budget?.categoryLimits ?? {}) };
    if (action.categoryId) {
      if (!budget) {
        setActionError({ id: messageId, message: "Set a monthly budget first, then a category sub-limit can be applied." });
        setActionBusyId(null);
        return;
      }
      if (action.amount == null) {
        setActionError({ id: messageId, message: "This category proposal has no amount." });
        setActionBusyId(null);
        return;
      }
      monthlyLimit = budget.monthlyLimit;
      categoryLimits[action.categoryId] = action.amount;
    }
    if (monthlyLimit == null) {
      setActionError({ id: messageId, message: "This proposal has no amount." });
      setActionBusyId(null);
      return;
    }

    try {
      const result = await api<{ budget: BudgetSettings }>("/api/paypilot/budget", {
        method: "PUT",
        body: JSON.stringify({ monthlyLimit, categoryLimits }),
      });
      setApplied((current) => ({ ...current, [messageId]: true }));
      onBudgetSaved(result.budget);
    } catch (error) {
      setActionError({
        id: messageId,
        message: error instanceof ApiError ? error.message : "Could not apply the budget proposal.",
      });
    } finally {
      setActionBusyId(null);
    }
  }

  return (
    <Card
      kicker="NATURAL-LANGUAGE ASSISTANT"
      title="Ask PayPilot"
      action={
        <span className="tick rounded-full border border-ink-600 px-2.5 py-1 text-fog-500">
          facts from server · not model guesses
        </span>
      }
      className="flex min-h-[560px] flex-col"
    >
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            applied={applied[message.id] === true}
            actionBusy={actionBusyId === message.id}
            actionError={actionError?.id === message.id ? actionError.message : null}
            onPrepare={onPrepare}
            onApplyBudget={() => message.proposedAction && void applyBudget(message.id, message.proposedAction)}
          />
        ))}
        {busy && (
          <p className="font-mono text-[11px] text-fog-500" role="status">
            Classifying the request and grounding the reply…
          </p>
        )}
      </div>

      {/* Dynamic suggestions from the last assistant reply; fall back to defaults. */}
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-700 pt-3">
        {suggestionButtons}
        {onResetConversation && (
          <button
            type="button"
            disabled={busy || resetPending}
            onClick={resetConversation}
            className="ml-auto rounded-full border border-ink-600 px-2.5 py-1 text-[10px] text-fog-400 transition-colors hover:border-coral-500 hover:text-coral-600 disabled:opacity-50"
          >
            {resetPending ? "Resetting…" : "Reset conversation"}
          </button>
        )}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message PayPilot</span>
          <textarea
            id="paypilot-message-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={1_000}
            placeholder="Ask about spending, a budget, a purchase plan…"
            className="field resize-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy || input.trim().length === 0}
          className="rounded-full bg-coral-500 px-4 py-2.5 font-display text-sm font-bold text-ink-950 transition-colors hover:bg-coral-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <p className="mt-2 text-[10.5px] leading-relaxed text-fog-500">
        The assistant classifies intent. Any amount, order or balance in a reply is read from your
        server-verified records. Payment preparation and budget changes always need a separate
        confirmation.
      </p>
    </Card>
  );
}

function MessageBubble({
  message,
  applied,
  actionBusy,
  actionError,
  onPrepare,
  onApplyBudget,
}: {
  message: Message;
  applied: boolean;
  actionBusy: boolean;
  actionError: string | null;
  onPrepare: (plan: PurchasePlan, offerId: string) => void;
  onApplyBudget: () => void;
}) {
  const user = message.role === "user";
  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
          user ? "bg-ink-950 text-ivory-50" : "border border-ink-600 bg-ink-800 text-fog-400"
        }`}
      >
        {!user && message.source && (
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`tick rounded-full px-1.5 py-0.5 ${
                message.source === "ai"
                  ? "bg-lilac-300/15 text-lilac-400"
                  : "bg-ink-700 text-fog-500"
              }`}
            >
              {message.source === "ai" ? "AI · validated" : "rules · deterministic"}
            </span>
            {message.source !== "ai" && message.aiStatus && (
              <span className="text-[10px] text-fog-500">
                {message.aiStatus === "error"
                  ? "model output rejected — rule fallback used"
                  : "no model configured — rule fallback used"}
              </span>
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap">{message.text}</p>

        {message.plan && (
          <div className="mt-2 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2">
            <p className="text-[11.5px] text-fog-300">
              Plan for <b>{message.plan.buyerLabel}</b> · {message.plan.candidates.length} eligible
              quote{message.plan.candidates.length === 1 ? "" : "s"} · recommended{" "}
              <b>
                {message.plan.candidates.find((c) => c.offerId === message.plan?.recommendedOfferId)?.sellerName ??
                  message.plan.candidates[0]?.sellerName}
              </b>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {message.plan.candidates.slice(0, 3).map((offer) => (
                <button
                  key={offer.offerId}
                  type="button"
                  onClick={() => message.plan && onPrepare(message.plan, offer.offerId)}
                  className="rounded-full border border-coral-500/50 px-2.5 py-1 text-[10.5px] text-coral-600 transition-colors hover:bg-coral-500 hover:text-ink-950"
                >
                  Prepare {offer.sellerName} · {formatMoney(offer.amount)}
                </button>
              ))}
            </div>
          </div>
        )}

        {message.proposedAction && (
          <div className="mt-2 rounded-lg border border-cyan-400/40 bg-cyan-400/5 px-3 py-2">
            <p className="text-[11.5px] text-fog-300">
              Proposed {message.proposedAction.categoryId
                ? `${CATEGORY_BY_ID[message.proposedAction.categoryId].label} sub-limit`
                : "monthly planning limit"}
              {message.proposedAction.monthlyLimit != null
                ? `: ${formatMoney(message.proposedAction.monthlyLimit)}`
                : message.proposedAction.amount != null
                  ? `: ${formatMoney(message.proposedAction.amount)}`
                  : ""}
              . Nothing is saved yet.
            </p>
            {applied ? (
              <p className="mt-1 text-[11px] text-sage-400" role="status">✓ Applied through the explicit budget call.</p>
            ) : (
              <button
                type="button"
                onClick={onApplyBudget}
                disabled={actionBusy}
                className="mt-1.5 rounded-full bg-cyan-400 px-3 py-1 text-[11px] font-semibold text-ink-950 transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                {actionBusy ? "Applying…" : "Confirm and apply budget"}
              </button>
            )}
            {actionError && <p className="mt-1 text-[11px] text-coral-600">{actionError}</p>}
          </div>
        )}

        {message.notes && message.notes.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10.5px] text-fog-500">Classifier notes</summary>
            <ul className="mt-1 list-disc pl-4 text-[10.5px] text-fog-500">
              {message.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
