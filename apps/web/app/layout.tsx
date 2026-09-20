import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Delicate Courier | Same-Day Delivery for Perishables",
  description:
    "Same-day courier service specialising in baked goods, fresh food, and flowers. Fast, reliable, and handled with care across Pretoria.",
  keywords: [
    "courier",
    "same-day delivery",
    "perishable goods",
    "flowers delivery",
    "baked goods courier",
    "Pretoria courier",
  ],
  openGraph: {
    title: "Delicate Courier",
    description: "Same-day delivery for the things that matter most.",
    type: "website",
    url: "https://delicatecourier.co.za",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className="scroll-smooth">
      <body className="bg-white text-[#0A0A0A] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
