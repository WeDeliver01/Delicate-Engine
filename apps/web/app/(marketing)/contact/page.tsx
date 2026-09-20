import SiteNav from "@/components/marketing/SiteNav";
import Footer from "@/components/marketing/Footer";

export const metadata = {
  title: "Contact Us | Delicate Courier",
  description:
    "Get in touch with Delicate Courier. Message us on WhatsApp, call, or email for help with your perishable goods delivery.",
};

export default function ContactPage() {
  return (
    <>
      <SiteNav />
      <main>
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-5 pt-16 pb-10 md:pt-20 md:pb-14 text-center">
            <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold">
              Contact us
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mt-3">
              Better yet, <span className="text-[#E84A8A]">see us in person</span>
            </h1>
            <p className="text-[16px] text-[#6B6661] mt-4 leading-relaxed">
              Have a delivery in mind or a question about your goods? Message us on WhatsApp and a
              real person will help you.
            </p>
            <a
              href="https://wa.me/27785746727"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-6 bg-[#0A0A0A] text-white px-6 py-3.5 rounded-full text-[14px] font-medium hover:bg-[#E84A8A] transition-colors"
            >
              Message us on WhatsApp
            </a>
          </div>
        </section>

        <section className="bg-white pb-20 md:pb-28">
          <div className="max-w-5xl mx-auto px-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#FAFAF9] border border-[#ECEAE6] rounded-2xl p-7">
              <p className="text-[15px] font-semibold">Delicate Courier (Pty) Ltd</p>
              <p className="text-[14px] text-[#6B6661] mt-2 leading-relaxed">
                14 Camellia Avenue, Lynnwood Ridge, Pretoria, South Africa
              </p>
              <a
                href="tel:+27785746727"
                className="block text-[14px] text-[#0A0A0A] mt-3 hover:text-[#E84A8A]"
              >
                +27 78 574 6727
              </a>
              <a
                href="mailto:support@delicatecourier.co.za"
                className="block text-[14px] text-[#0A0A0A] hover:text-[#E84A8A]"
              >
                support@delicatecourier.co.za
              </a>
            </div>
            <div className="bg-[#FAFAF9] border border-[#ECEAE6] rounded-2xl p-7">
              <p className="text-[12px] uppercase tracking-[0.1em] text-[#A8A39C] mb-2">
                Delivery hours
              </p>
              <div className="text-[14px] text-[#6B6661] leading-relaxed">
                Mon to Fri 08:00 to 16:00
                <br />
                Sat 08:00 to 14:00
                <br />
                Sun closed, and closed on public holidays
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
