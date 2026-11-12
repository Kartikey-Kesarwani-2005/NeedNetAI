"use client";

/**
 * PayPal JS SDK loader (browser only).
 *
 * Shared by the existing market checkout and the PayPilot dashboard. The SDK
 * is sandbox-only: the client id comes from the server's public config route,
 * never from a bundled secret.
 */

export interface PayPalButtonsConfig {
  style?: Record<string, string | number>;
  createOrder: () => string;
  onApprove: (data: { orderID: string }) => void;
  onCancel?: (data: { orderID?: string }) => void;
  onError?: (err: unknown) => void;
}

export interface PayPalNamespace {
  Buttons: (config: PayPalButtonsConfig) => {
    render: (target: HTMLElement) => Promise<void>;
    close: () => void;
  };
}

declare global {
  interface Window {
    paypal?: PayPalNamespace | Promise<PayPalNamespace>;
  }
}

let sdkRequest: Promise<PayPalNamespace> | null = null;
let sdkScript: HTMLScriptElement | null = null;

/**
 * buyer-country is a sandbox-only SDK parameter: it makes the popup serve the
 * buyer-side experience for the given country instead of the developer
 * account's region, which sidesteps the known unsupported-region login error.
 */
export function loadPayPalSdk(clientId: string, buyerCountry?: string): Promise<PayPalNamespace> {
  const existing = window.paypal;
  if (existing) return Promise.resolve(existing as PayPalNamespace);
  if (sdkRequest) return sdkRequest;
  sdkRequest = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    sdkScript = script;
    script.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({
      "client-id": clientId,
      currency: "EUR",
      intent: "capture",
      ...(buyerCountry ? { "buyer-country": buyerCountry } : {}),
    })}`;
    script.async = true;
    script.onload = () => {
      const ns = window.paypal as PayPalNamespace | undefined;
      if (ns) {
        resolve(ns);
      } else {
        resetSdkRequest();
        reject(new Error("PayPal SDK loaded without a usable namespace"));
      }
    };
    script.onerror = () => {
      // A failed script must never poison every later retry: drop the cached
      // promise AND the dead <script> so the next attempt starts clean.
      resetSdkRequest();
      reject(new Error("PayPal SDK failed to load"));
    };
    document.head.appendChild(script);
  });
  return sdkRequest;
}

/** Clear the cached SDK promise/script after a failed load (retry-safe). */
export function resetSdkRequest(): void {
  sdkRequest = null;
  if (sdkScript) {
    sdkScript.remove();
    sdkScript = null;
  }
}
