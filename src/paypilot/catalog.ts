/**
 * Offer→category catalog for stored orders (SERVER ONLY).
 *
 * Orders persist only ids. The deterministic seed market is the source for
 * mapping an offer back to its category; PayPilot-created orders also store
 * categoryId directly, so user-created demand is never guessed.
 */
import { BUYERS, type CategoryId } from "@/data/demo";
import { computeMarket } from "@/engine/engine";

let catalog: Map<string, CategoryId> | null = null;

export function categoryForOfferId(offerId: string): CategoryId | null {
  if (!catalog) {
    const computed = computeMarket(BUYERS);
    catalog = new Map(computed.offers.map((o) => [o.id, o.categoryId]));
  }
  return catalog.get(offerId) ?? null;
}
