import type { Metadata } from "next";
import LiveView from "./live-view";

/**
 * The recipient's page, opened from the link in their SMS or email.
 *
 * Outside the marketing and portal groups on purpose: someone opens this on a phone while
 * waiting at a gate, and a site nav, a chatbot and a footer are all in the way of the one
 * thing they came for.
 */
export const metadata: Metadata = {
  title: "Your delivery | Delicate Courier",
  // The link is the authorisation. A crawler that finds one in a forwarded message must not
  // put it in an index where anyone can read it back out.
  robots: { index: false, follow: false, nocache: true },
};

export default async function LiveTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LiveView token={token} />;
}
