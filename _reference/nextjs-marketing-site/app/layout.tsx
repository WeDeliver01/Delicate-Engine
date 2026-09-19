import type { Metadata } from "next";
import "./globals.css";
import ClientLayout from "./ClientLayout";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <head suppressHydrationWarning>
        {/* Prevent browser bfcache restoration on Back/Forward */}
        <meta
          httpEquiv="Cache-Control"
          content="no-cache, no-store, must-revalidate"
        />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="bg-white text-[#0A0A0A] antialiased">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}