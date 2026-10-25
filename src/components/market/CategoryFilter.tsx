"use client";

import { CATEGORIES, type CategoryId } from "@/data/demo";
import { useMarket } from "@/state/store";

export function CategoryFilter() {
  const { state, setFilter } = useMarket();

  const countFor = (cat: CategoryId): number => state.buyers.filter((b) => b.categoryId === cat).length;

  const chips: Array<{ key: CategoryId | "all"; label: string; count: number; color: string }> = [
    { key: "all", label: "All demand", count: state.buyers.length, color: "#E9EDF4" },
    ...CATEGORIES.map((c) => ({ key: c.id, label: c.label, count: countFor(c.id), color: c.color })),
  ];

  return (
    <div role="group" aria-label="Filter network by product category" className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const active = state.filter === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.key)}
            aria-pressed={active}
            className={`tick flex items-center gap-2 border px-2.5 py-1.5 transition-all duration-200 ${
              active
                ? "border-fog-100 bg-fog-100 text-ink-900"
                : "border-ink-600 text-fog-400 hover:border-fog-400 hover:text-fog-100"
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: chip.color }} aria-hidden />
            {chip.label}
            <span className={active ? "text-ink-500" : "text-fog-500"}>{String(chip.count).padStart(2, "0")}</span>
          </button>
        );
      })}
    </div>
  );
}
