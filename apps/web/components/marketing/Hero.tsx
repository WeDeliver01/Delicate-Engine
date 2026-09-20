"use client";
import { useState, useEffect } from "react";
import { LINKS, SITE } from "@/lib/constants";
import AnimateOnScroll from "@/components/marketing/AnimateOnScroll";

const slideshowImages = [
  "/images/cupcakes.png",
  "/images/cakes.png",
  "/images/delicate-cupcakes.webp",
  "/images/product-gift.jpg",
  "/images/product-flowers.jpg",
  "/images/about-owner.jpg",
  "/images/product-cake.jpg",
  "/images/hero-courier.jpg",
];

const trustedBy = [
  { name: "Honey Bee Baker", logo: "/images/logos/honey_bee.svg" },
  { name: "Sweet Thymes Bakery", logo: "/images/logos/sweet_thymes.jpg" },
  { name: "Baked By Nataleen", logo: "/images/logos/baked_by_nataleen.png" },
  { name: "Melinda's Kitchen", logo: "/images/logos/melinda.png" },
] as const;

export default function Hero() {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev === slideshowImages.length - 1 ? 0 : prev + 1));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const goToPrevious = () => {
    setCurrentImageIndex((prev) => (prev === 0 ? slideshowImages.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentImageIndex((prev) => (prev === slideshowImages.length - 1 ? 0 : prev + 1));
  };

  return (
    <section className="pt-32 pb-24 bg-gradient-to-br from-[#F8F6F3] to-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          {/* Tagline badge */}
          <AnimateOnScroll delay={1}>
            <span className="inline-block text-xs font-medium tracking-widest uppercase text-gray-500 border border-gray-300 px-3 py-1 rounded-full mb-6">
              Now dispatching across Gauteng
            </span>
          </AnimateOnScroll>

          {/* Headline */}
          <AnimateOnScroll animation="fade-left" delay={2}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6">
              {SITE.tagline}
            </h1>
          </AnimateOnScroll>

          {/* Description */}
          <AnimateOnScroll animation="fade-left" delay={3}>
            <p className="text-lg text-gray-600 leading-relaxed mb-10 max-w-xl">
              Same-day delivery for perishables
            </p>
          </AnimateOnScroll>

          {/* CTA Buttons */}
          <AnimateOnScroll animation="fade-up" delay={4}>
            <div className="flex flex-wrap gap-4">
              <a
                href={LINKS.portal}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-900 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-gray-700 transition-colors"
              >
                Book a Shipment
              </a>
              <a
                href="/quote/step1"
                target="_blank"
                className="border border-gray-300 text-gray-700 px-6 py-3 rounded-full text-sm font-medium hover:border-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                Get a Quote
              </a>
            </div>
          </AnimateOnScroll>
        </div>

        {/* Slideshow */}
        <AnimateOnScroll animation="fade-right" delay={3} className="mt-16">
          <div className="relative w-full h-64 sm:h-80 lg:h-96 bg-gray-200 rounded-xl overflow-hidden">
            <img
              src={slideshowImages[currentImageIndex]}
              alt={`Slideshow image ${currentImageIndex + 1}`}
              className="w-full h-full object-cover transition-opacity duration-300"
            />

            {/* Left Arrow */}
            <button
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Previous image"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>

            {/* Right Arrow */}
            <button
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Next image"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>

            {/* Dots */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
              {slideshowImages.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentImageIndex(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    currentImageIndex === index ? "bg-white w-4" : "bg-white/50 hover:bg-white/80"
                  }`}
                  aria-label={`Go to image ${index + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Trusted by */}
          <div className="mt-12 text-center">
            <p className="text-sm uppercase tracking-wider text-gray-400 mb-4">
              Trusted by Gauteng's finest bakeries & florists
            </p>

            <div className="relative w-full overflow-hidden">
              <div className="flex whitespace-nowrap">
                <div className="flex items-center animate-marquee">
                  {/* Original set */}
                  {trustedBy.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 mx-6">
                      <img
                        src={item.logo}
                        alt={item.name}
                        className="h-6 sm:h-8 w-auto object-contain"
                      />
                      <span className="text-sm font-medium text-gray-600">{item.name}</span>
                    </div>
                  ))}

                  {/* Duplicate for seamless loop */}
                  {trustedBy.map((item) => (
                    <div key={`${item.name}-dup`} className="flex items-center gap-2 mx-6">
                      <img
                        src={item.logo}
                        alt={item.name}
                        className="h-6 sm:h-8 w-auto object-contain"
                      />
                      <span className="text-sm font-medium text-gray-600">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              <style jsx>{`
                .animate-marquee {
                  animation: marquee 25s linear infinite;
                }
                @keyframes marquee {
                  0% {
                    transform: translateX(0);
                  }
                  100% {
                    transform: translateX(-50%);
                  }
                }
              `}</style>
            </div>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
