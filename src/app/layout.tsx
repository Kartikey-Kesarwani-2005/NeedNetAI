import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Space_Grotesk, Fraunces } from "next/font/google";
import "./globals.css";
import { MarketProvider } from "@/state/store";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Editorial serif — the "ledger print" voice of the brand (headlines, prices)
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NeedNet AI — The Living Market",
  description:
    "NeedNet AI organizes scattered customer demand into compatible groups so competing sellers can respond with relevant offers. Buyers approve individual purchases through server-verified PayPal Sandbox checkout. Built on synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} ${fraunces.variable}`}>
      <body>
        <MarketProvider>{children}</MarketProvider>
      </body>
    </html>
  );
}
