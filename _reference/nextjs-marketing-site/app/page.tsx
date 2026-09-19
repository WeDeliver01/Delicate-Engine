import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";

const TRUST = [
  { icon: "verified_user", color: "#7C5CFF", title: "Full liability coverage", body: "If your goods are damaged in transit, we take full responsibility. Our claims process is quick, transparent, and hassle-free." },
  { icon: "notifications_active", color: "#F7A8CE", title: "Real-time tracking", body: "Track every step on our website, with instant updates via SMS and email so you and your customers stay informed." },
  { icon: "lock", color: "#E84A8A", title: "Secure delivery", body: "We use the latest technology and best practices so your goods arrive safely and securely." },
];

const PLANS = [
  { name: "Starter", price: "R999", popular: false, body: "Ideal for clients doing 20+ deliveries a month.", features: ["15% off default rates", "API integration", "Flat-rate pricing", "Priority support"] },
  { name: "Growth", price: "R1999", popular: true, body: "Ideal for clients doing 35+ deliveries a month.", features: ["All Starter Pack benefits", "25% off default rates", "One free monthly shipment", "Public holiday delivery"] },
  { name: "Enterprise", price: "R3499", popular: false, body: "Ideal for clients doing 55+ deliveries a month.", features: ["All Growth Pack benefits", "40% off default rates", "Zero surcharges", "Dedicated account manager"] },
];

const BAKERIES = [
  { name: "Honey Bee Baker", mono: "HB", color: "#8A5A06", bg: "#FBF1D6", href: "https://honeybeebaker.co.za", logo: "/images/logos/honey_bee.svg" },
  { name: "Baked by Nataleen", mono: "BN", color: "#C13B73", bg: "#FCEEF4", href: "https://bakedbynataleen.co.za", logo: "/images/logos/baked_by_nataleen.png" },
  { name: "Melinda's Kitchen", mono: "MK", color: "#5B43C9", bg: "#EFE9FF", href: "https://melindaskitchen.co.za", logo: "/images/logos/melinda.png" },
  { name: "Cakeaways by Marone", mono: "CM", color: "#8A5A06", bg: "#FBF1D6", href: "https://cakeawaysbymarone.co.za", logo: "/images/logos/cakeaways_marone.webp" },
  { name: "Baked ka Lerato", mono: "BL", color: "#C13B73", bg: "#FCEEF4", href: "https://www.instagram.com/baked_kalerato", logo: "/images/logos/baked_kalerato.jpg" },
  { name: "Sweet Thymes", mono: "ST", color: "#5B43C9", bg: "#EFE9FF", href: "https://www.instagram.com/sweetthymesza", logo: "/images/logos/sweet_thymes.jpg" },
  { name: "Food at Home SA", mono: "FH", color: "#8A5A06", bg: "#FBF1D6", href: "https://www.instagram.com/foodathomesa", logo: "/images/logos/food_at_home.jpg" },
  { name: "Dirty Peach Cake Boutique", mono: "DP", color: "#C13B73", bg: "#FCEEF4", href: "https://www.instagram.com/dirtypeach_cakeboutique/", logo: "/images/logos/dirty_peach.jpg" },
  { name: "Boledi's Vanilla Blessings Cakery", mono: "BV", color: "#5B43C9", bg: "#EFE9FF", href: "https://www.instagram.com/boledisvb.cakery/", logo: "/images/logos/boledis.jpg" },
  { name: "Elation by Leona's Cakery", mono: "EL", color: "#8A5A06", bg: "#FBF1D6", href: "https://leonascakery.co.za/", logo: "/images/logos/leonas.jpg" },
];

const WHITE = { backgroundColor: "#ffffff" };

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="bg-white">

        {/* Hero */}
        <section style={WHITE} className="px-5 py-16 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[13px] font-semibold text-[#E84A8A] uppercase tracking-wider">The same-day courier for perishables</p>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08] text-[#0A0A0A] mt-4">
              Same-day courier for cakes and <span className="text-[#E84A8A]">fresh bakes</span>.
            </h1>
            <p className="text-[18px] text-[#6B6661] mt-5 max-w-md leading-relaxed">
              Built for perishables. While others avoid delicate deliveries, it is all we do. White-glove handling for your most fragile artisanal creations.
            </p>
            <div className="flex flex-wrap gap-4 mt-8">
              <a href="https://delicatecourier.shiplogic.com" target="_blank" rel="noopener noreferrer" className="bg-[#0A0A0A] text-white px-8 py-3 rounded-2xl text-[14px] font-medium hover:bg-[#E84A8A] transition-colors active:scale-95">Book a shipment</a>
              <a href="https://delicatecourier.shiplogic.com/track" target="_blank" rel="noopener noreferrer" className="border border-[#DAD6CF] text-[#0A0A0A] px-8 py-3 rounded-2xl text-[14px] font-medium hover:border-[#0A0A0A] transition-colors">Track a delivery</a>
            </div>
          </div>
          <div className="relative">
            <img src="/images/driver.jpg" alt="Delicate Courier driver carrying a boxed delivery" loading="eager" className="w-full h-[460px] object-cover object-top rounded-xl" />
            <div className="absolute bottom-4 left-4 bg-white rounded-xl shadow-sm px-4 py-3 flex items-center gap-3">
              <span aria-hidden="true" className="material-symbols-outlined text-[#E84A8A]">local_shipping</span>
              <div>
                <p className="text-[11px] text-[#86817A] uppercase tracking-wide">Same-day courier</p>
                <p className="text-sm font-semibold text-[#0A0A0A]">Handled with care</p>
              </div>
            </div>
          </div>
        </section>

        {/* Why bakers trust us (bento) */}
        <section style={WHITE} className="px-5 py-16 max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-[32px] font-bold text-center text-[#0A0A0A]">Why the best bakers trust us</h2>
          <p className="text-[16px] text-[#6B6661] text-center mt-2 max-w-xl mx-auto leading-relaxed">
            We treat every parcel like it is our own, ensuring genuine care, attention, and respect for your goods from start to finish.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 items-stretch">
            <div className="flex flex-col rounded-xl overflow-hidden border border-[#ECEAE6] bg-white">
              <img src="/images/damaged-cake.jpg" alt="A cake damaged in transit inside its delivery box" loading="lazy" className="w-full h-52 object-cover" />
              <div className="p-6 flex flex-col grow">
                <h3 className="text-[20px] font-semibold">{TRUST[0].title}</h3>
                <p className="text-sm text-[#86817A] mt-2 leading-relaxed">{TRUST[0].body}</p>
                <span aria-hidden="true" className="material-symbols-outlined text-[#7C5CFF] text-[20px] mt-3">{TRUST[0].icon}</span>
              </div>
            </div>

            <div className="flex flex-col rounded-xl overflow-hidden border border-[#ECEAE6] bg-white">
              <img src="/images/trained-drivers.jpg" alt="A trained driver loading boxed goods into a delivery vehicle" loading="lazy" className="w-full h-52 object-cover" />
              <div className="p-6 flex flex-col grow">
                <h3 className="text-[20px] font-semibold">Trained for high-value goods</h3>
                <p className="text-sm text-[#86817A] mt-2 leading-relaxed">Our drivers are trained to load, secure, and transport cakes and high-value goods with the care they deserve.</p>
                <span aria-hidden="true" className="material-symbols-outlined text-[#F4C430] text-[20px] mt-3">verified</span>
              </div>
            </div>

            <div className="flex flex-col rounded-xl overflow-hidden border border-[#ECEAE6] bg-white">
              <img src="/images/account-manager.jpg" alt="Our client care manager at work" loading="lazy" className="w-full h-52 object-cover object-center" />
              <div className="p-6 flex flex-col grow">
                <h3 className="text-[20px] font-semibold">Dedicated account manager</h3>
                <p className="text-sm text-[#86817A] mt-2 leading-relaxed">A direct line to someone who understands your business. No bots, just white-glove human service for artisanal bakers.</p>
                <span aria-hidden="true" className="material-symbols-outlined text-[#7C5CFF] text-[20px] mt-3">support_agent</span>
              </div>
            </div>

            <div className="md:col-span-2 bg-[#0A0A0A] text-white rounded-xl p-6 flex flex-col">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="material-symbols-outlined text-[#F7A8CE]">{TRUST[1].icon}</span>
                <div>
                  <h3 className="text-[20px] font-semibold">{TRUST[1].title}</h3>
                  <p className="text-sm text-[#B8B3AC] mt-2 leading-relaxed">{TRUST[1].body}</p>
                </div>
              </div>
              <img src="/images/tracking-timeline.png" alt="Shipment tracking timeline: created, collected, in transit, out for delivery, delivered" loading="lazy" className="mt-5 w-full rounded-lg bg-white p-2" />
            </div>

            <div className="bg-white rounded-xl p-6 border border-[#ECEAE6] flex flex-col justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-[#E84A8A]">{TRUST[2].icon}</span>
              <h3 className="text-[20px] font-semibold mt-4">{TRUST[2].title}</h3>
              <p className="text-sm text-[#86817A] mt-2 leading-relaxed">{TRUST[2].body}</p>
            </div>
          </div>
        </section>

        {/* Choose your speed */}
        <section id="services" style={WHITE} className="px-5 py-16 max-w-6xl mx-auto scroll-mt-20">
          <h2 className="text-3xl sm:text-[32px] font-bold text-center text-[#0A0A0A]">Choose your speed</h2>
          <p className="text-[16px] text-[#6B6661] text-center mt-2 max-w-xl mx-auto leading-relaxed">
            From routine deliveries to emergency cake rescues, we have a service level that fits your kitchen rhythm.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 rounded-xl overflow-hidden border border-[#ECEAE6] bg-white mt-12">
            <img src="/images/fleet.jpg" alt="Delicate Courier branded delivery vehicles" loading="lazy" className="w-full h-full object-cover min-h-[280px]" />
            <div className="p-8 flex flex-col gap-6 justify-center">
              <div>
                <h3 className="text-[20px] font-semibold">Standard delivery</h3>
                <p className="text-sm text-[#6B6661] mt-2 leading-relaxed">Book at least one day in advance. Arrives the same day within your selected time slot. Cost-effective and ideal for routine deliveries.</p>
                <a href="/quote/step1" className="inline-block mt-3 text-[14px] font-medium text-[#E84A8A] hover:text-[#0A0A0A] transition-colors">Book standard</a>
              </div>
              <div className="h-px bg-[#F0EDE9]" />
              <div>
                <h3 className="text-[20px] font-semibold">On-demand delivery</h3>
                <p className="text-sm text-[#6B6661] mt-2 leading-relaxed">For when time is not on your side. We dispatch a driver immediately and reach the destination within 90 minutes of booking.</p>
                <a href="/quote/step1" className="inline-block mt-3 text-[14px] font-medium text-[#E84A8A] hover:text-[#0A0A0A] transition-colors">Book on-demand</a>
              </div>
            </div>
          </div>
        </section>

        {/* Plans */}
        <section id="plans" style={WHITE} className="px-5 py-16 max-w-6xl mx-auto scroll-mt-20">
          <h2 className="text-3xl sm:text-[32px] font-bold text-center text-[#0A0A0A]">Designed for frequent shippers</h2>
          <p className="text-[16px] text-[#6B6661] text-center mt-2 max-w-xl mx-auto leading-relaxed">
            Scaling your bakery should not mean scaling your stress. Our membership plans grow with you.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 items-start">
            {PLANS.map((p) => (
              <div key={p.name} className={`relative rounded-xl p-6 ${p.popular ? "bg-[#0A0A0A] text-white" : "bg-white border border-[#ECEAE6]"}`}>
                {p.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#E84A8A] text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1 rounded-full">Most popular</span>
                )}
                <p className="text-[20px] font-bold">{p.name}</p>
                <p className="text-[34px] font-extrabold mt-1"><span className="font-mono">{p.price}</span><span className="text-sm font-normal" style={{ color: p.popular ? "#B8B3AC" : "#86817A" }}>/mo</span></p>
                <p className="text-sm mt-2" style={{ color: p.popular ? "#B8B3AC" : "#86817A" }}>{p.body}</p>
                <div className="h-px my-4" style={{ background: p.popular ? "#262624" : "#F0EDE9" }} />
                <ul className="space-y-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 py-1 text-sm" style={{ color: p.popular ? "#F2EFEA" : "#3A3631" }}>
                      <span aria-hidden="true" className="material-symbols-outlined text-[#E84A8A] text-[18px]">check</span>{f}
                    </li>
                  ))}
                </ul>
                <a href="/membership" className={`block text-center mt-6 rounded-full py-3 text-[14px] font-medium transition-colors ${p.popular ? "bg-[#E84A8A] text-white" : "bg-[#0A0A0A] text-white hover:bg-[#E84A8A]"}`}>Get started</a>
              </div>
            ))}
          </div>
        </section>

        {/* Bakeries we deliver for */}
        <section style={WHITE} className="px-5 py-16 max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-[32px] font-bold text-center text-[#0A0A0A]">Bakeries we deliver for</h2>
          <p className="text-[16px] text-[#6B6661] text-center mt-2 max-w-xl mx-auto leading-relaxed">
            We are proud to handle deliveries for some of the finest bakeries and dessert makers around Gauteng.
          </p>
          <div className="mt-12 overflow-hidden marquee-mask">
            <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
              {[...BAKERIES, ...BAKERIES].map((b, i) => {
                const dup = i >= BAKERIES.length;
                return (
                  <a
                    key={`${b.name}-${i}`}
                    href={b.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-hidden={dup || undefined}
                    tabIndex={dup ? -1 : undefined}
                    className="group shrink-0 w-44 mr-4 bg-white border border-[#ECEAE6] rounded-xl p-5 flex flex-col items-center text-center hover:border-[#0A0A0A] transition-colors"
                  >
                    {b.logo ? (
                      <div className="w-14 h-14 flex items-center justify-center">
                        <img src={b.logo} alt={`${b.name} logo`} loading="lazy" className="max-w-full max-h-full object-contain" />
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: b.bg }}>
                        <span className="font-bold text-lg" style={{ color: b.color }}>{b.mono}</span>
                      </div>
                    )}
                    <p className="text-sm font-semibold mt-3">{b.name}</p>
                  </a>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section style={WHITE} className="px-5 py-16 max-w-6xl mx-auto">
          <div className="bg-[#FAFAF9] border border-[#ECEAE6] rounded-xl p-10 text-center">
            <h2 className="text-3xl sm:text-[32px] font-bold text-[#0A0A0A]">Ready to ship something special?</h2>
            <p className="text-[16px] text-[#6B6661] mt-2 max-w-lg mx-auto leading-relaxed">
              Join the bakers across Pretoria who trust Delicate Courier for their daily logistics.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
              <a href="/quote/step1" className="bg-[#0A0A0A] text-white px-7 py-3 rounded-2xl text-[14px] font-medium hover:bg-[#E84A8A] transition-colors">Get a quote</a>
              <a href="https://wa.me/27785746727" target="_blank" rel="noopener noreferrer" className="border border-[#DAD6CF] text-[#0A0A0A] px-7 py-3 rounded-2xl text-[14px] font-medium hover:border-[#0A0A0A] transition-colors">Message us on WhatsApp</a>
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
