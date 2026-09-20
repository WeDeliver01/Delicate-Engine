"use client";

import { useState } from "react";

const FAQS = [
  {
    q: "How much is a standard delivery?",
    a: "Our delivery rates are based on the exact collection and delivery addresses. To get a quick quote, use our quote tool. It is fast and accurate, and we are happy to help if you need it.",
  },
  {
    q: "Do you deliver all over Gauteng?",
    a: "We deliver in most parts of Gauteng. If your area does not show up on our quote tool, send us an email at support@delicatecourier.co.za and we will gladly assist you.",
  },
  {
    q: "Is it same-day delivery?",
    a: "Yes, it is. We offer same-day delivery as standard for all bookings. Just make sure to book early enough in the day.",
  },
  {
    q: "What are your delivery hours?",
    a: "We deliver from Monday to Saturday, between 08:00 and 16:00. Let us know if you have special timing requests.",
  },
  {
    q: "Do you only deliver cakes?",
    a: "Not at all. We deliver a range of perishable goods, including cakes, baked treats, fresh flowers, and food platters. If it needs a little extra care, we are the team to help.",
  },
  {
    q: "What happens after I book?",
    a: "Once your booking is confirmed, our system automatically assigns a driver. You will receive live updates via SMS or email so you are always in the loop.",
  },
];

export default function SiteFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 md:py-28 bg-[#FAFAF9] border-t border-[#F0EDE9]">
      <div className="max-w-3xl mx-auto px-5">
        <p className="text-[11px] tracking-[0.13em] uppercase text-[#E84A8A] font-semibold text-center">
          Good to know
        </p>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mt-2">
          Frequently asked questions
        </h2>
        <p className="text-center text-[#6B6661] mt-3">
          Reach us at support@delicatecourier.co.za if you cannot find an answer to your question.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="bg-white border border-[#ECEAE6] rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 text-left px-5 py-4"
                >
                  <span className="text-[15px] font-medium text-[#0A0A0A]">{f.q}</span>
                  <span
                    className={`text-[#E84A8A] text-xl leading-none transition-transform ${isOpen ? "rotate-45" : ""}`}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 -mt-1 text-[14.5px] text-[#6B6661] leading-relaxed">
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
