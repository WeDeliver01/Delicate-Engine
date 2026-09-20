import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";
import { Estimator } from "./estimator";

export const metadata = { title: "Get a Quote | Delicate Courier" };

export default function QuotePage() {
  return (
    <>
      <SiteNav />
      <main className="bg-white">
        <section
          style={{ backgroundColor: "#ffffff" }}
          className="px-5 py-16 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-5 gap-12"
        >
          <div className="md:col-span-2">
            <p className="text-[13px] font-semibold text-[#E84A8A] uppercase tracking-wider">
              Instant estimate
            </p>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08] text-[#0A0A0A] mt-4">
              What will your delivery cost?
            </h1>
            <p className="text-[18px] text-[#6B6661] mt-5 leading-relaxed">
              Tell us where we collect and where we deliver. The estimate uses our standard rates;
              account holders see their own pricing when they book in the portal.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-[#3A3631]">
              <li className="flex gap-3">
                <span aria-hidden className="material-symbols-outlined text-[#E84A8A]">
                  verified_user
                </span>
                Liability cover available on every booking
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="material-symbols-outlined text-[#F4C430]">
                  schedule
                </span>
                Standard (next-day slot) or On-demand (within 90 minutes)
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="material-symbols-outlined text-[#7C5CFF]">
                  add_location_alt
                </span>
                Add several drops to one collection
              </li>
            </ul>
          </div>
          <div className="md:col-span-3">
            <Estimator />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
