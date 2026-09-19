import { TRUST_FEATURES } from "@/lib/constants";
import AnimateOnScroll from "@/components/AnimateOnScroll";

export default function WhyTrustUs() {
  return (
    <section id="why-us" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header */}
        <AnimateOnScroll animation="fade-left" className="mb-14">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">
            Why Choose Us
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Why our clients trust our service
          </h2>
          <p className="text-gray-500 max-w-xl">
            We built Delicate Courier specifically for businesses that can't
            afford for things to go wrong in transit.
          </p>
        </AnimateOnScroll>

        {/* Feature cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {TRUST_FEATURES.map((feature, i) => (
            <AnimateOnScroll
              key={feature.id}
              animation="fade-up"
              delay={((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6}
            >
              <div
                className="relative rounded-xl p-6 flex flex-col gap-4 h-full overflow-hidden"
                style={{
                  backgroundImage: `url(${feature.backgroundImage || "/images/cakes.png"})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                {/* Blur overlay - you can control the blur intensity here */}
                <div className="absolute inset-0 bg-black/30"></div>

                {/* Content - stays sharp on top */}
                <div className="relative z-10">
                  <div className="w-10 h-10 bg-white/50 rounded-lg flex items-center justify-center mb-2">
                    <img
                      src={feature.icon || "/images/delicate-cake.webp"}
                      alt={feature.title}
                      className="h-6 w-auto"
                    />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white mb-2 ">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-white font-bold leading-relaxed from-[#F8F6F3] ">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            </AnimateOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}