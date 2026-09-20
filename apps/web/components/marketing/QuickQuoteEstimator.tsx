"use client";

import { useState, useEffect, useRef } from "react";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_HEADERS = {
  "Accept-Language": "en",
  "User-Agent": "DelicateCourierQuoteGenerator/1.0 (contact@delicatecourier.co.za)",
};

function AutocompleteInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    clearTimeout(timerRef.current!);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: value.trim(),
          format: "json",
          limit: "5",
          countrycodes: "za",
        });
        const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
          headers: NOMINATIM_HEADERS,
        });
        const data = await res.json();
        setSuggestions(data.map((i: any) => i.display_name));
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timerRef.current!);
  }, [value]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#E84A8A] focus:border-[#ECEAE6] outline-none transition text-sm"
      />
      {show && (loading || suggestions.length > 0) && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-gray-500 flex items-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-[#ECEAE6] border-t-transparent"></span>
              Searching...
            </div>
          ) : (
            suggestions.map((s, i) => (
              <div
                key={i}
                onMouseDown={() => {
                  onChange(s);
                  setShow(false);
                }}
                className="p-3 cursor-pointer hover:bg-gray-50 text-sm border-b border-gray-100 last:border-0"
              >
                {s}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function QuickQuoteEstimator() {
  const [isOpen, setIsOpen] = useState(false);
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [serviceLevel, setServiceLevel] = useState("standard");
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState<{
    distance_km: number;
    price: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setEstimate(null);

    try {
      const res = await fetch("/api/estimate/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup_address: pickup,
          delivery_address: delivery,
          service_level: serviceLevel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Calculation failed");
      setEstimate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleTalkToUs = () => {
    setIsOpen(false);
    setTimeout(() => {
      const footer = document.getElementById("contact");
      if (footer) {
        footer.scrollIntoView({ behavior: "smooth" });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    }, 100);
  };

  return (
    <>
      {/* Section */}
      <div className="text-center py-16 bg-gray-100">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-4">
          Get a Quick Quote Estimate
        </h2>
        <p className="text-gray-600 max-w-2xl mx-auto mb-8 text-sm px-4">
          Enter your collection and delivery addresses to get a rough estimate. Final pricing may
          vary based on parcel size, service level, and time of day.
        </p>
        <button
          onClick={() => setIsOpen(true)}
          className="bg-[#0A0A0A] text-white px-8 py-3 rounded-full font-semibold hover:bg-[#E84A8A] transition-all shadow-md"
        >
          Get Quick Quote Estimate
        </button>
      </div>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex justify-between items-center p-5 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
              <h2 className="text-xl font-bold text-gray-800">Quick Quote Estimate</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5">
              <p className="text-gray-500 text-sm mb-5">
                Enter your collection and delivery addresses below.
              </p>

              <form onSubmit={handleCalculate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Collection address
                  </label>
                  <AutocompleteInput
                    value={pickup}
                    onChange={setPickup}
                    placeholder="123 Main St, Cape Town"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Delivery address
                  </label>
                  <AutocompleteInput
                    value={delivery}
                    onChange={setDelivery}
                    placeholder="45 Long St, Johannesburg"
                  />
                </div>

                {/* Custom Dropdown for Service Level */}
                <div className="relative w-full" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-left text-sm text-gray-800 flex justify-between items-center focus:ring-2 focus:ring-[#E84A8A]"
                  >
                    {serviceLevel === "standard" ? "Standard Delivery" : "On-Demand Delivery"}
                    <span className="material-symbols-outlined text-gray-500">
                      {isDropdownOpen ? "expand_less" : "expand_more"}
                    </span>
                  </button>

                  {isDropdownOpen && (
                    <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                      <li
                        className="px-4 py-3 hover:bg-gray-100 cursor-pointer text-sm"
                        onClick={() => {
                          setServiceLevel("standard");
                          setIsDropdownOpen(false);
                        }}
                      >
                        Standard Delivery
                      </li>
                      <li
                        className="px-4 py-3 hover:bg-gray-100 cursor-pointer text-sm"
                        onClick={() => {
                          setServiceLevel("ondemand");
                          setIsDropdownOpen(false);
                        }}
                      >
                        On-Demand Delivery
                      </li>
                    </ul>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !pickup.trim() || !delivery.trim()}
                  className="w-full bg-[#0A0A0A] text-white py-3 rounded-xl font-semibold hover:bg-[#E84A8A] transition disabled:opacity-50 text-base mt-2"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin rounded-full h-5 w-5 border-2 border-gray-800 border-t-transparent"></span>
                      Calculating...
                    </span>
                  ) : (
                    "Estimate"
                  )}
                </button>
              </form>

              {error && <p className="text-red-500 text-sm mt-4">{error}</p>}

              {estimate && (
                <div className="mt-5 p-5 bg-[#F9F5FC] rounded-xl border border-[#ECEAE6]/30">
                  <p className="text-sm text-gray-500">Estimated price</p>
                  <p className="text-3xl font-bold text-[#E84A8A] mt-1">
                    R {estimate.price.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                    ⓘ This is a rough estimate based on distance only. Final pricing may vary based
                    on parcel size, service level, and time of day.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 mt-5">
                    <a
                      href="/quote"
                      target="_blank"
                      className="flex-1 bg-[#0A0A0A] text-white text-center py-2.5 rounded-xl font-semibold hover:bg-[#E84A8A] transition"
                    >
                      Book This Delivery
                    </a>
                    <button
                      onClick={handleTalkToUs}
                      className="flex-1 border border-[#ECEAE6] text-[#E84A8A] py-2.5 rounded-xl font-semibold hover:bg-[#0A0A0A]/10 transition text-sm"
                    >
                      Talk to Us
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
