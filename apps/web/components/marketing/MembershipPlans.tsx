"use client";

import { useState } from "react";
import { X, CheckCircle, ChevronRight } from "lucide-react";
import AnimateOnScroll from "@/components/marketing/AnimateOnScroll";
import { LINKS } from "@/lib/constants";

/* ─── Plan data ─────────────────────────────────────────────────── */

const PLANS = [
  {
    id: "starter",
    title: "Delicate Starter Plan",
    price: "R999",
    highlighted: false,
    cardFeatures: [
      "15% OFF our default delivery rates",
      "Flat-rate pricing",
      "Dedicated account manager",
    ],
    modal: {
      title: "Delicate Starter Membership",
      price: "R999 / month",
      tagline: "For businesses with occasional deliveries",
      description:
        "Perfect for small businesses, bakeries or individuals sending a few deliveries per week. Enjoy discounted same-day courier rates and priority support for your perishable goods delivery needs.",
      features: [
        "15% OFF all delivery fees on every shipment",
        "Flat-Rate Pricing across all zones",
        "Dedicated account manager",
      ],
      idealFor:
        "Startup bakeries, home businesses, or online stores with light shipping volumes. Entrepreneurs testing new delivery routes or services.",
    },
  },
  {
    id: "growth",
    title: "Delicate Growth Plan",
    price: "R1999",
    highlighted: true,
    cardFeatures: [
      "25% OFF our default delivery rates",
      "Standard + On-demand delivery",
      "Public holiday delivery",
      "Free monthly shipment",
    ],
    modal: {
      title: "Delicate Growth Membership",
      price: "R1999 / month",
      tagline: "For businesses with regular deliveries",
      description:
        "Designed for growing bakeries, restarurants and florists with regular delivery needs. Features larger rate discounts, weekly billing and dedicated account support to streamline your logistics.",
      features: [
        "25% OFF all delivery fees on every shipment",
        "Flat-Rate Pricing (no surprises at checkout)",
        "Shipments available even on public holidays",
        "One free monthly shipment",
        "Dedicated customer support",
        "Zero Surcharges",
      ],
      idealFor:
        "Cafés, florists, and bakeries with daily deliveries. Businesses scaling their delivery operations. Anyone who wants a reliable, no-surprise courier partner.",
    },
  },
  {
    id: "enterprise",
    title: "Delicate Enterprise Plan",
    price: "R3499",
    highlighted: false,
    cardFeatures: ["40% OFF our default delivery", "1 Free shipment", "Zero surcharges"],
    modal: {
      title: "Delicate Enterprise Membership",
      price: "R3499 / month",
      tagline: "For businesses needing premium service",
      description:
        "Built for high-volume clients with complex delivery requirements. Enjoy custom pricing, fleet priority, API or system inegration and a dedicated operations manager to handle your account end-to-end.",
      features: [
        "40% OFF all delivery fees on every shipment",
        "Flat-Rate Pricing across all zones",
        "Shipments available even on public holidays",
        "One Monthly Free Shipment (anywhere in Gauteng!)",
        "Zero Surcharges",
        "Priority Support Line & faster dispatch",
      ],
      idealFor:
        "Large bakeries, franchises, and e-commerce businesses. Companies that value reliability, speed, and cost efficiency.",
    },
  },
];

/* ─── Payment / Join modal data ─────────────────────────────────── */

const STEPS = [
  "Choose your preferred membership plan (Starter, Growth, or Enterprise).",
  "Make your monthly payment to the account below.",
  "Include your Account Code (e.g. Dxx001) as your payment reference.",
  "Once your payment is processed, our team will activate your membership, you'll start shipping at discounted rates immediately.",
];

const WHY_JOIN = [
  "Guaranteed Savings: Lower your delivery costs with up to 40% off.",
  "Priority Service: Members get faster pickups and dedicated support.",
  "Flat-Rate Peace of Mind: Transparent pricing, no hidden fees.",
  "Business Flexibility: Upgrade, downgrade, or cancel anytime.",
  "Exclusive Perks: From monthly free shipments to public holiday service, your business never stops moving.",
];

/* ─── Backdrop ───────────────────────────────────────────────────── */

function Backdrop({ onClick }: { onClick: () => void }) {
  return <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClick} />;
}

/* ─── Payment modal ──────────────────────────────────────────────── */

function PaymentModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <Backdrop onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sticky header */}
          <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <h3 className="text-lg font-bold text-gray-900">How to Join a Membership Plan</h3>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-500 ml-3 shrink-0"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-6 flex flex-col gap-8">
            <p className="text-sm text-gray-600 leading-relaxed">
              Joining is simple! Follow these quick steps to activate your membership and start
              saving today:
            </p>

            {/* Steps */}
            <div className="flex flex-col gap-4">
              {STEPS.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <span
                    className="w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: "#E84A8A" }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>

            {/* Payment details */}
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
              <p className="text-sm font-semibold text-gray-900 mb-4">Payment Details</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {[
                    ["Bank", "First National Bank (FNB)"],
                    ["Account Type", "Cheque / Current"],
                    ["Account Number", "63136576676"],
                    ["Branch Code", "250655"],
                    ["Reference", "Your Account Code – xxx001"],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td className="py-2 pr-4 text-gray-500 font-medium w-36">{label}</td>
                      <td className="py-2 text-gray-800 font-mono text-xs">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                As soon as payment reflects, your membership will be activated instantly, no
                downtime, no waiting.
              </p>
            </div>

            {/* Why join */}
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">
                {" "}
                Why Join Delicate Courier Memberships?
              </p>
              <ul className="flex flex-col gap-2">
                {WHY_JOIN.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <CheckCircle
                      size={15}
                      className="mt-0.5 shrink-0"
                      style={{ color: "#E84A8A" }}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Help */}
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
              <p className="text-sm font-semibold text-gray-900 mb-1">Need Help Choosing a Plan?</p>
              <p className="text-sm text-gray-500 mb-3">We'll help you find the perfect fit.</p>
              <p className="text-sm text-gray-700">
                Call or WhatsApp us at{" "}
                <a
                  href="https://wa.me/27785746727"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                  style={{ color: "#E84A8A" }}
                >
                  +27 78 574 6727
                </a>
              </p>
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#E84A8A" }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Plan detail modal ──────────────────────────────────────────── */

function PlanModal({
  plan,
  onClose,
  onJoin,
}: {
  plan: (typeof PLANS)[0];
  onClose: () => void;
  onJoin: () => void;
}) {
  return (
    <>
      <Backdrop onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sticky header */}
          <div className="sticky top-0 bg-[#F8F6F3] border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <p className="text-xs font-medium tracking-widest uppercase text-black-400">
              Membership plans that move your business forward
            </p>
            <button
              onClick={onClose}
              className=" bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-500 shrink-0 ml-3"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-6 flex flex-col gap-6  bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm">
            {/* Price badge */}
            <div
              className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-full text-white text-xs font-semibold"
              style={{ backgroundColor: "#E84A8A" }}
            >
              {plan.modal.price}
            </div>

            {/* Title + tagline */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">{plan.modal.title}</h3>
              <p className="text-sm text-gray-500 italic">{plan.modal.tagline}</p>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-600 leading-relaxed">{plan.modal.description}</p>

            {/* Features */}
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">You'll get:</p>
              <ul className="flex flex-col gap-2.5">
                {plan.modal.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle
                      size={15}
                      className="mt-0.5 shrink-0"
                      style={{ color: "#E84A8A" }}
                    />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Ideal for */}
            <div
              className="rounded-xl p-4 border"
              style={{ backgroundColor: "#FFFFFF", borderColor: "#E84A8A33" }}
            >
              <p className="text-sm font-semibold text-gray-900 mb-1">Ideal for:</p>
              <p className="text-sm text-gray-600 leading-relaxed">{plan.modal.idealFor}</p>
            </div>

            {/* Join button */}
            <button
              onClick={onJoin}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#E84A8A" }}
            >
              Join <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Main section ───────────────────────────────────────────────── */

export default function MembershipPlans() {
  const [activePlan, setActivePlan] = useState<(typeof PLANS)[0] | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showAccountCheck, setShowAccountCheck] = useState(false);

  const openPlan = (plan: (typeof PLANS)[0]) => {
    setActivePlan(plan);
    setShowPayment(false);
    setShowAccountCheck(false);
  };

  const closePlan = () => {
    setActivePlan(null);
    setShowPayment(false);
    setShowAccountCheck(false);
  };

  const closePayment = () => {
    setShowPayment(false);
    setActivePlan(null);
    setShowAccountCheck(false);
  };

  const closeAccountCheck = () => {
    setShowAccountCheck(false);
  };

  const getPlanSlug = (plan: (typeof PLANS)[number] | null) => {
    if (!plan) return "";
    return plan.title.toLowerCase().replace("delicate ", "").replace(" plan", "").trim();
  };

  const handleJoinClick = () => {
    setShowAccountCheck(true);
  };

  const handleYesAccount = () => {
    const planSlug = getPlanSlug(activePlan);
    window.location.href = `${LINKS.login}?next=/subscribe&plan=${encodeURIComponent(planSlug)}`;
  };

  const handleNoAccount = () => {
    const planSlug = getPlanSlug(activePlan);
    window.location.href = `${LINKS.register}?next=/subscribe&plan=${encodeURIComponent(planSlug)}`;
  };

  return (
    <>
      <section id="plans" className="py-24  bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <AnimateOnScroll animation="fade-left" className="mb-14">
            <p
              className="text-xs font-medium tracking-widest uppercase mb-3"
              style={{ color: "black" }}
            >
              Pricing
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              We have delicate membership plans for frequent shippers
            </h2>
            <p className="text-gray-500 max-w-xl">
              Save more as you ship more. Choose the plan that fits your business and start
              delivering smarter.
            </p>
          </AnimateOnScroll>

          {/* Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PLANS.map((plan, i) => (
              <AnimateOnScroll key={plan.id} animation="fade-up" delay={(i + 1) as 1 | 2 | 3}>
                <div
                  className={`card rounded-2xl p-8 flex flex-col gap-6 h-full ${
                    plan.highlighted ? "text-white" : "border border-gray-200 bg-white"
                  }`}
                  style={plan.highlighted ? { backgroundColor: "#c77dc7" } : undefined}
                >
                  {/* Plan name & price */}
                  <div>
                    <p
                      className={`text-xs font-medium tracking-widest uppercase mb-3 ${plan.highlighted ? "text-purple-200" : "text-gray-400"}`}
                    >
                      {plan.title}
                    </p>
                    <p
                      className={`text-4xl font-bold mb-1 ${plan.highlighted ? "text-white" : "text-gray-900"}`}
                    >
                      {plan.price}
                    </p>
                    <p
                      className={`text-sm ${plan.highlighted ? "text-purple-200" : "text-gray-400"}`}
                    >
                      per month
                    </p>
                  </div>

                  {/* Description */}
                  <p
                    className={`text-sm leading-relaxed mb-4 ${plan.highlighted ? "text-purple-100" : "text-gray-600"}`}
                  >
                    {plan.modal.description}
                  </p>

                  {/* Features */}
                  <ul className="flex flex-col gap-2.5 flex-1">
                    {plan.cardFeatures.map((f) => (
                      <li
                        key={f}
                        className={`flex items-start gap-2 text-sm ${plan.highlighted ? "text-purple-100" : "text-gray-600"}`}
                      >
                        <CheckCircle
                          size={15}
                          className="mt-0.5 shrink-0"
                          style={{ color: plan.highlighted ? "#F8F6F3" : "#E84A8A" }}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* Unified "Get Started" button */}
                  <button
                    onClick={() => openPlan(plan)}
                    className="mt-auto w-full text-center text-sm font-semibold px-5 py-3 rounded-xl transition-opacity hover:opacity-90 text-white"
                    style={{
                      backgroundColor: plan.highlighted ? "rgba(255,255,255,0.25)" : "#E84A8A",
                      border: plan.highlighted ? "1px solid rgba(255,255,255,0.4)" : "none",
                    }}
                  >
                    Subscribe to {plan.title.replace("Delicate ", "")}
                  </button>
                </div>
              </AnimateOnScroll>
            ))}
          </div>
        </div>
      </section>

      {/* Plan detail modal */}
      {activePlan && !showPayment && (
        <PlanModal plan={activePlan} onClose={closePlan} onJoin={handleJoinClick} />
      )}

      {/* Payment / join modal */}
      {showPayment && <PaymentModal onClose={closePayment} />}

      {/* Account check modal */}
      {showAccountCheck && (
        <>
          <Backdrop onClick={closeAccountCheck} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sticky header */}
              <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                <h3 className="text-lg font-bold text-gray-900">Account Check</h3>
                <button
                  onClick={closeAccountCheck}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-500 ml-3 shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-6 py-6 flex flex-col gap-6">
                <p className="text-sm text-gray-600 leading-relaxed text-center">
                  Do you already have an account with Delicate Courier?
                </p>

                <div className="flex flex-col gap-4">
                  <button
                    onClick={handleYesAccount}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: "#E84A8A" }}
                  >
                    Yes, I have an account
                  </button>
                  <button
                    onClick={handleNoAccount}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: "#E84A8A" }}
                  >
                    No, I am new
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
