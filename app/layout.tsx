import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueueMint — skip-the-line passes, minted by the cent",
  description:
    "An on-chain skip-the-line gallery. A venue opens a limited daily edition of skip-passes; mint one for 10–30¢ in native USDC, burned when you reach the front. A curator agent prices the drop; an x402 endpoint lets agents skip a queue programmatically. On ARC.",
  keywords: "QueueMint, ARC, USDC, NFT, skip the queue, x402, micropayments, agents, RWA, payments",
};

export const viewport: Viewport = { themeColor: "#eceae4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
