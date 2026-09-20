"use client";

export default function QuoteHeader() {
  return (
    <header className="bg-white border-b h-16 flex items-center justify-between px-4 flex-shrink-0 relative">
      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border">
        <img alt="Company Logo" className="w-full h-full object-cover" src="/images/logo.png" />
      </div>
      <h1 className="text-lg font-bold text-[#0A0A0A] absolute left-55 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
        Delicate Courier Quote Generator
      </h1>
      <div className="w-10" />
    </header>
  );
}
