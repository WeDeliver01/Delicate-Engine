"use client";

import { LINKS } from "@/lib/constants";
import AnimateOnScroll from "@/components/marketing/AnimateOnScroll";

export default function RegisterTrack() {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <AnimateOnScroll animation="fade-up" delay={1}>
          <h2 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-8">
            Same-Day Delivery for Perishables
          </h2>
        </AnimateOnScroll>

        <AnimateOnScroll animation="fade-up" delay={2}>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href={LINKS.register}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[#ECEAE6] text-[#E84A8A] px-8 py-3 rounded-full text-sm font-medium hover:bg-white hover:border-[#ECEAE6] transition-colors"
            >
              Register an account
            </a>
            <a
              href={LINKS.track}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[#ECEAE6] text-[#E84A8A] px-8 py-3 rounded-full text-sm font-medium hover:bg-white hover:border-[#ECEAE6] transition-colors"
            >
              Track a delivery
            </a>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
