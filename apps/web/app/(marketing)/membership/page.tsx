import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";
import { Check } from "@/components/marketing/Icons";

export const metadata = {
  title: "Delicate Membership Plans | Delicate Courier",
  description:
    "Membership plans for frequent shippers. Discounted same-day courier rates, priority support, and dedicated account management.",
};

const PLANS = [
  {
    name: "Starter",
    price: "R999",
    popular: false,
    body: "Perfect for small businesses or individuals sending a few deliveries per week. Discounted same-day courier rates and priority support for your perishable goods.",
    features: [
      "15% off our default delivery rates",
      "Flat-rate pricing",
      "Dedicated account manager",
    ],
  },
  {
    name: "Growth",
    price: "R1999",
    popular: true,
    body: "Designed for growing bakeries, restaurants, and florists with regular delivery needs. Larger discounts, weekly billing, and dedicated account support.",
    features: [
      "25% off our default delivery rates",
      "Standard plus on-demand delivery",
      "Public holiday delivery",
      "Free monthly shipment",
    ],
  },
  {
    name: "Enterprise",
    price: "R3499",
    popular: false,
    body: "Built for high-volume clients with complex delivery requirements. Custom pricing, fleet priority, API integration, and a dedicated operations manager.",
    features: ["40% off our default delivery rates", "One free shipment", "Zero surcharges"],
  },
];

export default function MembershipPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-5 pt-16 pb-10 md:pt-20 md:pb-14 text-center">
            <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold">
              For frequent shippers
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mt-3">
              Delicate <span className="text-[#E84A8A]">membership plans</span>
            </h1>
            <p className="text-[16px] text-[#6B6661] mt-4 leading-relaxed">
              Plans built for businesses that ship often. Lower your delivery rates, get priority
              support, and keep a direct line to a dedicated account manager.
            </p>
          </div>
        </section>

        <section className="bg-white pb-20 md:pb-28">
          <div className="max-w-5xl mx-auto px-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
              {PLANS.map((p) => (
                <div
                  key={p.name}
                  className={`rounded-2xl p-6 bg-white relative ${p.popular ? "border-2 border-[#0A0A0A]" : "border border-[#ECEAE6]"}`}
                >
                  {p.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#0A0A0A] text-white text-[10px] font-semibold uppercase tracking-[0.05em] px-3 py-1 rounded-full">
                      Most popular
                    </span>
                  )}
                  <p className="text-[14px] font-semibold">{p.name}</p>
                  <p className="text-[30px] font-bold tracking-tight mt-2">
                    <span className="font-mono">{p.price}</span>
                    <span className="text-[13px] text-[#86817A] font-normal">/mo</span>
                  </p>
                  <p className="text-[13px] text-[#86817A] mt-3 leading-relaxed">{p.body}</p>
                  <div className="h-px bg-[#F0EDE9] my-5" />
                  <div className="flex flex-col gap-1">
                    {p.features.map((f) => (
                      <div
                        key={f}
                        className="flex items-center gap-2.5 py-1 text-[13.5px] text-[#3A3631]"
                      >
                        <Check /> {f}
                      </div>
                    ))}
                  </div>
                  <a
                    href="https://wa.me/27785746727"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block text-center mt-6 rounded-full py-3 text-[13.5px] font-medium transition-colors ${p.popular ? "bg-[#0A0A0A] text-white hover:bg-[#E84A8A]" : "border border-[#DAD6CF] hover:border-[#0A0A0A]"}`}
                  >
                    Get started
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#FAFAF9] border-y border-[#F0EDE9] py-16 md:py-20">
          <div className="max-w-3xl mx-auto px-5 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Not sure which plan fits?
            </h2>
            <p className="text-[15px] text-[#6B6661] mt-3 leading-relaxed">
              Tell us how often you ship and what you send. We will help you pick the plan that
              saves you the most.
            </p>
            <a
              href="/contact"
              className="inline-block mt-6 bg-[#0A0A0A] text-white px-6 py-3.5 rounded-full text-[14px] font-medium hover:bg-[#E84A8A] transition-colors"
            >
              Talk to us
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
