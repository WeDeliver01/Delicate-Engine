import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";
import TrackForm from "../../track/track-form";

export const metadata = { title: "Track a Delivery | Delicate Courier" };

/**
 * Tracking by waybill, as a link anyone can open.
 *
 * This is the URL every notification points at, so it is deliberately short enough to read
 * down a phone and say out loud, and it lives in the marketing section — no sign-in, no
 * account, no role. The person waiting at the door is usually not our customer, and a
 * tracking link that asks them to log in tells them nothing.
 */
export default async function TrackingByWaybill({
  params,
}: {
  params: Promise<{ waybill: string }>;
}) {
  const { waybill } = await params;
  return (
    <>
      <SiteNav />
      <main className="bg-white">
        <section
          style={{ backgroundColor: "#ffffff" }}
          className="px-5 py-20 max-w-3xl mx-auto text-center"
        >
          <p className="text-[13px] font-semibold text-[#E84A8A] uppercase tracking-wider">
            Tracking
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08] text-[#0A0A0A] mt-4">
            Where is my delivery?
          </h1>
          <TrackForm initial={decodeURIComponent(waybill)} />
        </section>
      </main>
      <Footer />
    </>
  );
}
