export const LINKS = {
  portal: "/portal",
  login: "/login?next=/portal",
  register: "/login?next=/portal/accounts/new",
  track: "/track",
  whatsapp: "https://wa.me/27785746727",
  email: "mailto:support@delicatecourier.co.za",
};

export const SITE = {
  name: "Delicate Courier",
  tagline: "We care about your perishable goods",
  phone: "+27 78 574 6727",
  email: "support@delicatecourier.co.za",
  address: "14 Camellia Avenue, Lynnwood Ridge, Pretoria, South Africa",
  hours: {
    monday: "08:00 – 16:00",
    tuesday: "08:00 – 16:00",
    wednesday: "08:00 – 16:00",
    thursday: "08:00 – 16:00",
    friday: "08:00 – 16:00",
    saturday: "08:00 – 14:00",
    sunday: "Closed",
  },
};

export const QUOTE_CONSTANTS = {
  COST_PER_KM: 1.7,
  MARGIN: 0.62,
};

export const NAV_LINKS = [
  { label: "Home", href: "/", external: false },
  {
    label: "BOOK A SHIPMENT",
    href: "/login?next=/portal",
    external: false,
  },
  {
    label: "Get a quote",
    href: "/quote",
    external: false,
  },
];

export const COMPANY_LINKS = [
  {
    label: "Delicate Membership Plans",
    href: "https://delicatecourier.co.za/delicate-membership-plans",
    external: true,
  },
  {
    label: "Delicate Liability Cover",
    href: "https://delicatecourier.co.za/delicate-liability-cover",
    external: true,
  },
  {
    label: "Terms & Conditions",
    href: "https://delicatecourier.co.za/terms-%26-conditions",
    external: true,
  },
  {
    label: "Payment Information",
    href: "https://delicatecourier.co.za/payment-information",
    external: true,
  },
  {
    label: "Acceptable Use Policy",
    href: "https://delicatecourier.co.za/acceptable-use-policy",
    external: true,
  },
];

export const SOCIAL_LINKS = [
  {
    label: "Facebook",
    href: "https://www.facebook.com/profile.php?id=61572385413961",
    icon: "facebook",
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/delicatecourier?igsh=MXZjYzI4MnFwM3hsYw==",
    icon: "instagram",
  },
  { label: "LinkedIn", href: "#", icon: "linkedin" },
  {
    label: "WhatsApp",
    href: "https://wa.me/27785746727",
    icon: "whatsapp",
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@delicatecourier?_r=1&_t=ZS-96ylwCxPcP6",
    icon: "tiktok",
  },
];

export const SERVICE_LEVELS = [
  {
    id: "standard",
    title: "Standard Delivery",
    description:
      "Perfect for planned shipments. Book in advance to ensure your perishable goods delivery is reliable and arrives the same day within your selected time slot, cost-effective and ideal for routine deliveries. Deliveries booked at least 1 day in advance.",
    features: [
      "Same-day delivery",
      "Pre-scheduled pickups",
      "Real-time tracking",
      "Proof of delivery",
    ],
    backgroundImage: "/images/cupcakes.png",
    iconName: "/icons/standard.png",
  },
  {
    id: "ondemand",
    title: "On-Demand Delivery",
    description:
      "For when time isn’t on your side, our same-day courier service ensures that your cake delivery and other perishable goods delivery are handled with urgency. We dispatch a driver as soon as you book. All collections and deliveries are completed on the same day of booking.",
    features: [
      "A driver dispatched as soon as you book",
      "Live GPS tracking",
      "Priority handling",
      "Instant confirmation",
    ],
    backgroundImage: "/images/delicate-cake.webp",
    iconName: "/icons/on-demand.png",
  },
];

export const TRUST_FEATURES = [
  {
    id: "liability",
    title: "Liability Coverage",
    description:
      "Every shipment in our care is protected by our delicate liability coverage. If your goods are damaged in transit, we take full responsibility. Our claims process is quick, transparent and hassle-free.",
    backgroundImage: "/images/contact-courier.jpg",
    icon: "/icons/insurance.png",
  },

  {
    id: "care",
    title: "Handled with Care",
    description:
      "We treat every parcel like it's our own. We are doing delivery differently, with genuine care, attention, and respect for you goods from start to finish.",
    backgroundImage: "/images/hero-courier.jpg",
    icon: "/icons/handle.png",
  },
  {
    id: "temperature",
    title: "Temperature-Controlled Deliveries",
    description:
      "From pick-up to drop-off, your perishable goods stay cool and air-conditioned throught the journey. Your products arrive as fresh and perfect as when they left.",
    backgroundImage: "/images/temperature_control.jpg",
    icon: "/icons/temperature-control.png",
  },
  {
    id: "real-time",
    title: "Real-Time Tracking & Notifications",
    description:
      "Track every stop of your delivery in real-time on our platform. We also send instant updates via SMS and email so you and your customers are informed every moment of the way.",
    backgroundImage: "/images/real-tracking.jpg",
    icon: "/icons/gps.png",
  },
  {
    id: "support",
    title: "Dedicated Account Manager",
    description:
      "Every client receives a dedicated account manager who is ready to assist with anything from special requests to delivery support. You always have a direct line to someone who understands your business.",
    backgroundImage: "/images/dedicated_account_manager.jpg",
    icon: "/icons/customer-service.png",
  },
  {
    id: "security",
    title: "Secure Delivery",
    description:
      "We take the security of your packages seriously. We use the latest technology and best practices to ensure your perishable goods arrive safely and securely.",
    backgroundImage: "/images/secure_delivery.png",
    icon: "/icons/shield.png",
  },
];

export const MEMBERSHIP_PLANS = [
  {
    id: "starter",
    title: "Delicate Starter Membership Plan",
    price: "R999/Month",
    description:
      "Designed for growing bakeries, restaurants, and florists with regular cake delivery needs, including cake delivery in Pretoria. This service features larger rate discounts, weekly billing, and dedicated account support to streamline your logistics for perishable goods delivery and same-day courier options.",
    features: [
      "15% OFF our default delivery rates",
      "Flat-rate pricing",
      "Dedicated account manager",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    id: "growth",
    title: "Delicate Growth Membership Plan",
    price: "R1999/Month",
    description:
      "Designed for growing bakeries, restaurants, and florists with regular cake delivery needs, including cake delivery in Pretoria. This service features larger rate discounts, weekly billing, and dedicated account support to streamline your logistics for perishable goods delivery and same-day courier options.",
    features: [
      "25% OFF our default delivery rates",
      "Standard + On-demand delivery",
      "Public holiday delivery",
      "Free monthly shipment",
    ],
    cta: "Start Growing",
    highlighted: true,
  },
  {
    id: "enterprise",
    title: "Delicate Enterprise Plan",
    price: "R3499/Month",
    description:
      "Built for high-volume clients with complex delivery requirements, including cake delivery in Pretoria and perishable goods delivery. Enjoy custom pricing, fleet priority, API or system integration, and a dedicated operations manager to handle your account end-to-end, ensuring efficient same-day courier services.",
    features: ["40% OFF our default delivery", "1 Free shipment", "Zero surcharges"],
    cta: "Contact Us",
    highlighted: false,
  },
];

export const FAQS = [
  {
    id: "faq-1",
    question: "How much is a standard delivery?",
    answer:
      "Our delivery rates are based on the exact collection and delivery addresses. To get a quick quote, use the Quick Quote tool on our booking page.",
  },
  {
    id: "faq-2",
    question: "Do you deliver all over Gauteng?",
    answer:
      "We deliver in most parts of Gauteng. If your area doesn't show up on our Quick Quote tool, email support@delicatecourier.co.za and we will gladly assist you.",
  },
  {
    id: "faq-3",
    question: "Do you offer same-day delivery?",
    answer:
      "Yes. We offer same-day delivery as standard for all bookings. Just make sure to book early enough in the day.",
  },
  {
    id: "faq-4",
    question: "What are your delivery hours?",
    answer:
      "We deliver Monday to Saturday, between 08:00 and 16:00. Let us know if you have special timing requests.",
  },
  {
    id: "faq-5",
    question: "Do you only deliver cakes?",
    answer:
      "Not at all. We deliver a range of perishable goods, including cakes, baked treats, fresh flowers and food platters. If it needs a little extra care, we are the team to help.",
  },
  {
    id: "faq-6",
    question: "What happens after I book?",
    answer:
      "Once your booking is confirmed, our system automatically assigns a driver. You will receive live updates via SMS or email so you are always in the loop.",
  },
  {
    id: "faq-7",
    question: "What happens if my order is damaged in transit?",
    answer:
      "All deliveries are covered by our liability policy. If your order is damaged due to courier handling, we will work with you to resolve the issue promptly.",
  },
];
