/**
 * Best-effort agent activity logging (SERVER ONLY).
 *
 * Activity is an audit trail, never a source of financial truth. A failed
 * write must not break a payment or an auth flow, so callers get null instead
 * of an exception.
 */
import { appendActivity, type ActivityInput } from "./store";

export async function logActivity(input: ActivityInput) {
  return appendActivity(input);
}
