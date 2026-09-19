import { MapPin, Phone, Mail, MessageCircle, Clock } from "lucide-react";
import { LINKS, SITE } from "@/lib/constants";
import AnimateOnScroll from "@/components/AnimateOnScroll";

const DELIVERY_HOURS = [
  { day: "Monday",    hours: SITE.hours.monday },
  { day: "Tuesday",   hours: SITE.hours.tuesday },
  { day: "Wednesday", hours: SITE.hours.wednesday },
  { day: "Thursday",  hours: SITE.hours.thursday },
  { day: "Friday",    hours: SITE.hours.friday },
  { day: "Saturday",  hours: SITE.hours.saturday },
  { day: "Sunday",    hours: SITE.hours.sunday },
];

export default function Contact() {
  return (
    <section id="contact" className="py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header */}
        <AnimateOnScroll animation="fade-left" className="mb-14">
          <p className="text-xs font-medium tracking-widest uppercase text-gray-400 mb-3">
            Contact
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Get in Touch
          </h2>
          <p className="text-gray-500 max-w-xl">
            Have a question or need a custom quote? Reach us on any of the
            channels below.
          </p>
        </AnimateOnScroll>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* Contact details */}
          <AnimateOnScroll animation="fade-left" delay={1}>
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                  <MapPin size={18} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-1">Address</p>
                  <p className="text-sm text-gray-500">{SITE.address}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                  <Phone size={18} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-1">Phone</p>
                  <a
                    href={`tel:${SITE.phone}`}
                    className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                  >
                    {SITE.phone}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                  <Mail size={18} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-1">Email</p>
                  <a
                    href={LINKS.email}
                    className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                  >
                    {SITE.email}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                  <MessageCircle size={18} className="text-gray-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-1">WhatsApp</p>
                  <a
                    href={LINKS.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                  >
                    Message us on WhatsApp
                  </a>
                </div>
              </div>

              {/* Quick action buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                <a
                  href={LINKS.whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-gray-900 text-white text-sm px-5 py-2.5 rounded-md hover:bg-gray-700 transition-colors"
                >
                  <MessageCircle size={16} />
                  WhatsApp Us
                </a>
                <a
                  href={LINKS.email}
                  className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm px-5 py-2.5 rounded-md hover:border-gray-500 hover:text-gray-900 transition-colors"
                >
                  <Mail size={16} />
                  Send Email
                </a>
              </div>
            </div>
          </AnimateOnScroll>

          {/* Delivery hours table */}
          <AnimateOnScroll animation="fade-right" delay={2}>
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
                  <Clock size={18} className="text-gray-500" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">
                  Delivery Hours
                </h3>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-gray-500 font-medium">Day</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {DELIVERY_HOURS.map(({ day, hours }) => (
                    <tr key={day} className="border-b border-gray-100 last:border-0">
                      <td className="py-2.5 text-gray-700">{day}</td>
                      <td className={`py-2.5 ${hours === "Closed" ? "text-gray-400" : "text-gray-700"}`}>
                        {hours}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="text-xs text-gray-400 mt-3">Closed on public holidays.</p>
            </div>
          </AnimateOnScroll>
        </div>
      </div>
    </section>
  );
}