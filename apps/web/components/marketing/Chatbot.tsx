"use client";

import { useState, useRef, useEffect } from "react";
import { LINKS, SITE } from "@/lib/constants";

interface FAQ {
  keywords: string[];
  answer: string;
}

const faqs: FAQ[] = [
  {
    keywords: ["price", "cost", "fee", "delivery cost", "how much", "rate", "rates"],
    answer:
      "Our delivery rates are based on the exact collection and delivery addresses. To get a quick quote, use the Quick Quote tool on our booking page.",
  },
  {
    keywords: ["track", "tracking", "track delivery", "where is", "where's", "status"],
    answer:
      "You can track your delivery in real-time using our tracking portal at " +
      LINKS.track +
      ". We also send live updates via SMS and email.",
  },
  {
    keywords: ["membership", "member", "plan", "benefits", "discount", "discounts"],
    answer:
      "We offer three membership plans: Starter (R999/month with 15% off), Growth (R1999/month with 25% off), and Enterprise (R3499/month with 40% off). Each plan includes dedicated account support and various perks.",
  },
  {
    keywords: ["area", "areas", "gauteng", "cover", "location", "locations", "deliver"],
    answer:
      "We deliver in most parts of Gauteng. If your area doesn't show up on our Quick Quote tool, email " +
      SITE.email +
      " and we'll gladly assist you.",
  },
  {
    keywords: ["same-day", "sameday", "same day", "urgent", "today"],
    answer:
      "Yes! We offer same-day delivery as standard for all bookings. Just make sure to book early enough in the day to secure your preferred time slot.",
  },
  {
    keywords: ["hour", "hours", "time", "open", "close", "delivery hours"],
    answer:
      "We deliver Monday to Friday, between 08:00 and 16:00. And Sartuday between 08:00 and 14:00. Let us know if you have special timing requests.",
  },
  {
    keywords: ["weekend", "saturday", "sunday"],
    answer:
      "We operate on Saturdays from 08:00 to 14:00 and are closed on Sundays. Public holiday deliveries are available for Growth and Enterprise members.",
  },
  {
    keywords: ["cake", "cakes", "bakery", "baked", "food", "flower", "flowers", "perishable"],
    answer:
      "We deliver a range of perishable goods, including cakes, baked treats, fresh flowers, and food platters. If it needs a little extra care, we're the team to help.",
  },
  {
    keywords: ["book", "booking", "order", "place", "how to book"],
    answer:
      "Once your booking is confirmed through our portal, our system automatically assigns a driver. You'll receive live updates via SMS or email so you're always in the loop.",
  },
  {
    keywords: ["damage", "damaged", "broken", "insurance", "liability", "claim"],
    answer:
      "All deliveries are covered by our liability policy. If your order is damaged due to courier handling, we'll work with you to resolve the issue promptly.",
  },
  {
    keywords: ["standard", "standard delivery", "regular"],
    answer:
      "Standard Delivery is perfect for planned shipments. Book in advance to ensure your perishable goods arrive the same day within your selected time slot. Cost-effective and ideal for routine deliveries.",
  },
  {
    keywords: ["on-demand", "ondemand", "express", "immediate", "90 minutes"],
    answer:
      "On-Demand Delivery is for when time isn't on your side. We dispatch a driver within 30 minutes after booking, guaranteeing your items reach their destination within 90 minutes.",
  },
  {
    keywords: ["contact", "phone", "call", "support", "email"],
    answer:
      "You can reach us at " +
      SITE.phone +
      " or email " +
      SITE.email +
      ". We're here to help with any questions about your delivery.",
  },
  {
    keywords: ["payment", "pay", "payment method", "cash", "card"],
    answer:
      "We accept various payment methods through our secure portal. Visit our Payment Information page for detailed options.",
  },
  {
    keywords: ["temperature", "cool", "refrigerated", "cold chain"],
    answer:
      "From pick-up to drop-off, your perishable goods stay cool and air-conditioned throughout the journey. Your products arrive as fresh as when they left.",
  },
  {
    keywords: ["driver", "courier", "pickup", "collect"],
    answer:
      "Our professional drivers are trained to handle perishable goods with care. You'll receive updates when your driver is on the way and when they arrive.",
  },
  {
    keywords: ["proof", "signature", "delivered"],
    answer:
      "Every delivery includes proof of delivery confirmation. You'll receive a notification once your package has been successfully delivered.",
  },
  {
    keywords: ["cancel", "cancelled", "refund"],
    answer:
      "If you need to cancel or modify a booking, please contact us as soon as possible. Our support team will assist you with any changes.",
  },
  {
    keywords: ["portal", "account", "login", "register"],
    answer:
      "Access your account at " +
      LINKS.portal +
      ". You can register for a new account, log in, and manage all your bookings in one place.",
  },
];

const quickReplies = [
  "How much does delivery cost?",
  "Track my delivery",
  "Membership benefits",
  "What areas do you cover?",
  "Do you offer same-day delivery?",
  "What are your operating hours?",
];

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ text: string; isUser: boolean }[]>([
    { text: "Hi, I'm Delicate Courier. How may I assist you today?", isUser: false },
  ]);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const findAnswer = (query: string): string => {
    const lowerQuery = query.toLowerCase();
    for (const faq of faqs) {
      for (const keyword of faq.keywords) {
        if (lowerQuery.includes(keyword.toLowerCase())) {
          return faq.answer;
        }
      }
    }
    return (
      "I'm sorry, I don't have an answer for that yet. Please email " +
      SITE.email +
      " or call " +
      SITE.phone +
      "."
    );
  };

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((prev) => [
      ...prev,
      { text: trimmed, isUser: true },
      { text: findAnswer(trimmed), isUser: false },
    ]);
    setInputValue("");
  };

  const handleQuickReply = (question: string) => {
    const normalized = question.trim().toLowerCase();
    if (normalized === "track my delivery" || normalized === "track delivery") {
      setMessages((prev) => [
        ...prev,
        { text: question, isUser: true },
        { text: `You can track your delivery here: ${LINKS.track}`, isUser: false },
      ]);
      window.open(LINKS.track, "_blank", "noopener,noreferrer");
      return;
    }
    handleSend(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSend(inputValue);
    }
  };

  const renderMessageText = (text: string, isUser: boolean) => {
    if (!text.includes("http")) return text;
    return (
      <span>
        {text.split(/(https?:\/\/\S+)/g).map((part, i) =>
          part.match(/^https?:\/\//) ? (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline break-all ${isUser ? "text-white opacity-90" : "text-[#0A0A0A]"}`}
            >
              {part}
            </a>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </span>
    );
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity ${
          isOpen ? "hidden" : ""
        }`}
        aria-label="Open chat"
      >
        <span className="material-symbols-outlined text-2xl">chat</span>
      </button>

      {/* Chat window */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-full max-w-[320px] sm:w-[320px] bg-white rounded-2xl shadow-2xl flex flex-col h-[500px] max-h-[80vh] border border-gray-100">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-100 rounded-t-2xl bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#0A0A0A] flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-white text-sm">support_agent</span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">Delicate Courier</h3>
                <p className="text-xs text-green-500 font-medium">Online</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close chat"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 bg-gradient-to-br from-[#F8F6F3] backdrop-blur-sm">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
                    msg.isUser
                      ? "bg-[#0A0A0A] text-white rounded-br-sm"
                      : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm"
                  }`}
                >
                  {renderMessageText(msg.text, msg.isUser)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick replies + input */}
          <div className="p-3 border-t border-gray-100 bg-white rounded-b-2xl">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {quickReplies.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleQuickReply(q)}
                  className="text-xs px-2 py-1 bg-[#F8F6F3] text-[#0A0A0A] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors font-medium"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-full focus:outline-none focus:border-[#0A0A0A] bg-gray-50"
              />
              <button
                onClick={() => handleSend(inputValue)}
                disabled={!inputValue.trim()}
                className="w-9 h-9 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-opacity flex-shrink-0"
                aria-label="Send message"
              >
                <span className="material-symbols-outlined text-sm">send</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
