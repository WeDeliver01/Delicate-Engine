import SiteNav from "@/components/SiteNav";
import SiteFaq from "@/components/SiteFaq";
import Footer from "@/components/Footer";

export const metadata = {
  title: "FAQ | Delicate Courier",
  description: "Answers to common questions about same-day delivery, pricing, delivery areas, and what happens after you book.",
};

export default function FaqPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-5 pt-16 pb-4 md:pt-20 text-center">
            <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold">Good to know</p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mt-3">
              Frequently asked <span className="text-[#E84A8A]">questions</span>
            </h1>
          </div>
        </section>
        <SiteFaq />
      </main>
      <Footer />
    </>
  );
}
