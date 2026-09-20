"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FAQS } from "@/lib/constants";
import AnimateOnScroll from "@/components/marketing/AnimateOnScroll";

export default function FAQ() {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  return (
    <section id="faq" className="py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <AnimateOnScroll animation="fade-left" className="mb-14">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">FAQ</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Common Questions</h2>
          <p className="text-gray-500 max-w-xl">
            Everything you need to know before your first delivery.
          </p>
        </AnimateOnScroll>

        {/* Accordion */}
        <AnimateOnScroll animation="fade-up" delay={1}>
          <div className="max-w-3xl flex flex-col divide-y divide-gray-200 border-t border-b border-gray-200">
            {FAQS.map((faq) => (
              <div key={faq.id}>
                <button
                  onClick={() => toggle(faq.id)}
                  className="w-full flex items-center justify-between py-5 text-left gap-4 group"
                  aria-expanded={openId === faq.id}
                >
                  <span className="text-sm font-medium text-gray-900 group-hover:text-gray-600 transition-colors">
                    {faq.question}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`text-gray-400 shrink-0 transition-transform duration-200 ${
                      openId === faq.id ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {openId === faq.id && (
                  <div className="pb-5">
                    <p className="text-sm text-gray-500 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
