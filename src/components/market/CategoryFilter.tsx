"use client";

import { CATEGORIES, type CategoryId } from "@/data/demo";
import { useMarket } from "@/state/store";

export function CategoryFilter() {
  const { state, setFilter } = useMarket();

  const countFor = (cat: CategoryId): number => state.buyers.filter((b) => b.categoryId === cat).length;

  const chips: Array<{ key: CategoryId | "all"; label: string; count: number; color: string }> = [
    { key: "all", label: "Everything", count: state.buyers.length, color: "#8f8264" },
    ...CATEGORIES.map((c) => ({ key: c.id, label: c.label, count: countFor(c.id), color: c.color })),
  ];

  return (
    <div role="group" aria-label="Filter by product category" className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const active = state.filter === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            aria-pressed={active}
            className={`tick flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all duration-200 ${
              active
                ? "border-ink-950 bg-ink-950 text-ink-850"
                : "border-ink-600 text-fog-300 hover:border-ink-500 hover:text-fog-100"
            }`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: chip.color }} aria-hidden />
            {chip.label}
            <span className={active ? "text-ink-500" : "text-fog-500"}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
