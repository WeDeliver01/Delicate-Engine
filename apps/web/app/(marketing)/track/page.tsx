import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";
import TrackForm from "./track-form";

export const metadata = { title: "Track a Delivery | Delicate Courier" };

/** Public tracking entry point. Live status per waybill lands with the shipments module (Phase 1). */
export default function TrackPage() {
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
          <p className="text-[18px] text-[#6B6661] mt-5 max-w-md mx-auto leading-relaxed">
            Enter the waybill number from your booking confirmation to see every step of its
            journey.
          </p>
          <TrackForm />
        </section>
      </main>
      <Footer />
    </>
  );
}
