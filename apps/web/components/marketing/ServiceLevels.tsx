import { CheckCircle } from "lucide-react";
import { SERVICE_LEVELS, LINKS } from "@/lib/constants";
import AnimateOnScroll from "@/components/marketing/AnimateOnScroll";

export default function ServiceLevels() {
  return (
    <section id="services" className="py-24 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <AnimateOnScroll animation="fade-left" className="mb-14">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">
            How We Deliver
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Explore our different service levels
          </h2>
          <p className="text-gray-500 max-w-xl">
            Whether you schedule in advance or need a courier right now, we have a service to match
            your workflow.
          </p>
        </AnimateOnScroll>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {SERVICE_LEVELS.map((service, i) => (
            <AnimateOnScroll key={service.id} animation="fade-up" delay={(i + 1) as 1 | 2}>
              <div
                className="relative rounded-xl p-8 flex flex-col gap-6 h-full overflow-hidden"
                style={{
                  backgroundImage: `url(${service.backgroundImage})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              >
                {/* Blur overlay */}
                <div className="absolute inset-0 backdrop-blur-sm bg-black/50"></div>

                {/* Content - stays sharp on top */}
                <div className="relative z-10">
                  {/* Placeholder icon */}
                  <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mb-2 ">
                    <img
                      src={service.iconName}
                      alt={service.title}
                      className="w-6 h-6 object-contain"
                    />
                  </div>

                  <div>
                    <h3 className="text-xl font-semibold text-white mb-2">{service.title}</h3>
                    <p className="text-white/80 text-sm leading-relaxed">{service.description}</p>
                  </div>

                  <ul className="flex flex-col gap-2 mt-4">
                    {service.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-white/80">
                        <CheckCircle size={16} className="text-white/60 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <a
                    href={LINKS.portal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-block border border-white/30 text-white text-sm px-5 py-2.5 rounded-md hover:bg-white/10 hover:border-white/50 transition-colors text-center"
                  >
                    Get Started
                  </a>
                </div>
              </div>
            </AnimateOnScroll>
          ))}
        </div>
        <div className="flex justify-center mt-15">
          <p>Collection cut-off time: 13:00</p>
        </div>
      </div>
    </section>
  );
}
