import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";
import { Check } from "@/components/marketing/Icons";

export const metadata = {
  title: "Delicate Liability Cover | Delicate Courier",
  description:
    "Every shipment in our care is protected by our liability coverage, with a claims process that is quick, transparent, and hassle-free.",
};

const COVERED = [
  "Baked goods and cakes",
  "Fresh food and platters",
  "Flowers and floral arrangements",
  "Temperature-sensitive perishables",
];

const CLAIM_STEPS = [
  {
    n: "1",
    title: "Let us know",
    body: "Contact your account manager or message us on WhatsApp as soon as you notice an issue with your delivery.",
  },
  {
    n: "2",
    title: "Share the details",
    body: "Send through your booking reference and a few photos of the goods so we can assess what happened.",
  },
  {
    n: "3",
    title: "We make it right",
    body: "We review quickly and resolve transparently. No runarounds, no drawn out back and forth.",
  },
];

export default function LiabilityCoverPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-5 pt-16 pb-10 md:pt-20 md:pb-14 text-center">
            <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold">
              Peace of mind
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mt-3">
              Delicate <span className="text-[#E84A8A]">liability cover</span>
            </h1>
            <p className="text-[16px] text-[#6B6661] mt-4 leading-relaxed">
              We have got you covered, literally. Every shipment in our care is protected by our
              liability coverage. If your goods are damaged in transit, we take full responsibility.
            </p>
          </div>
        </section>

        <section className="bg-white pb-6">
          <div className="max-w-6xl mx-auto px-5">
            <div className="bg-[#0A0A0A] text-white rounded-3xl px-7 py-12 md:px-14 md:py-16">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-[1.15] max-w-2xl">
                Full responsibility for goods damaged in our care.
              </h2>
              <p className="text-[15px] text-[#B8B3AC] mt-5 max-w-2xl leading-relaxed">
                Our claims process is quick, transparent, and hassle-free. Even for same-day courier
                services, there are no runarounds, ever. You ship with confidence, and we stand
                behind every delivery.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 md:py-24">
          <div className="max-w-5xl mx-auto px-5 grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <div>
              <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold">
                What is covered
              </p>
              <h2 className="text-3xl font-bold tracking-tight mt-2">
                Cover built for perishables
              </h2>
              <p className="text-[15px] text-[#6B6661] mt-4 leading-relaxed">
                Because perishables are all we carry, our cover is designed around them. Every
                booking in our care is protected from pick-up to drop-off.
              </p>
              <div className="mt-6 flex flex-col gap-1">
                {COVERED.map((c) => (
                  <div
                    key={c}
                    className="flex items-center gap-3 py-1.5 text-[15px] text-[#3A3631]"
                  >
                    <Check /> {c}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-[#FAFAF9] border border-[#ECEAE6] rounded-2xl p-7">
              <p className="text-[15px] font-semibold">Good to know</p>
              <p className="text-[14px] text-[#6B6661] mt-3 leading-relaxed">
                Liability cover applies to goods damaged while in our care during transit. For full
                terms, including any limits and exclusions, see our terms and conditions or ask your
                account manager.
              </p>
              <a
                href="https://delicatecourier.co.za/terms-%26-conditions"
                className="inline-block mt-5 text-[14px] font-medium text-[#0A0A0A] hover:text-[#E84A8A] transition-colors"
              >
                Read the terms and conditions
              </a>
            </div>
          </div>
        </section>

        <section className="bg-[#FAFAF9] border-y border-[#F0EDE9] py-20 md:py-24">
          <div className="max-w-5xl mx-auto px-5">
            <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold text-center">
              If something goes wrong
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mt-2">
              How a claim works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-12">
              {CLAIM_STEPS.map((s) => (
                <div key={s.n} className="bg-white border border-[#ECEAE6] rounded-2xl p-6">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#0A0A0A] text-white text-[15px] font-semibold">
                    {s.n}
                  </span>
                  <h3 className="text-[16px] font-semibold mt-4">{s.title}</h3>
                  <p className="text-[13.5px] text-[#86817A] mt-2 leading-relaxed">{s.body}</p>
                </div>
              ))}
            </div>
            <div className="text-center mt-10">
              <a
                href="https://wa.me/27785746727"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-[#0A0A0A] text-white px-6 py-3.5 rounded-full text-[14px] font-medium hover:bg-[#E84A8A] transition-colors"
              >
                Start a claim on WhatsApp
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
