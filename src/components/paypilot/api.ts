"use client";

/** Small typed fetch helper for the PayPilot dashboard. */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Structured, non-secret recovery details (e.g. a duplicate order reference). */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("The server could not be reached — check your connection and try again.", 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const record = payload != null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const message =
      typeof record.error === "string" && record.error.trim().length > 0
        ? record.error
        : `Request failed (HTTP ${response.status})`;
    const code = typeof record.code === "string" ? record.code : undefined;
    throw new ApiError(message, response.status, code, record);
  }
  return payload as T;
}
