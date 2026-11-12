"use client";

import type { PublicPaymentIntent } from "@/paypilot/types";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface PayPalPublicConfig {
  configured: boolean;
  environment: string | null;
  clientId: string | null;
}

export interface ConfirmCheckout {
  reference: string;
  paypalOrderId: string;
  amount: string;
  currency: "EUR";
  token: string;
  environment: string | null;
}

export interface PrepareResponse {
  intent: PublicPaymentIntent;
  replayed: boolean;
  next: string;
}

export interface ConfirmResponse {
  checkout: ConfirmCheckout;
  replayed: boolean;
  note: string;
}
