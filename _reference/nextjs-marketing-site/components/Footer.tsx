const SERVICE_LINKS = [
  { label: 'Standard delivery', href: '/#services' },
  { label: 'On-demand delivery', href: '/#services' },
  { label: 'Membership plans', href: '/membership' },
  { label: 'Liability cover', href: '/liability-cover' },
]

const COMPANY_LINKS = [
  { label: 'FAQs', href: '/faq', external: false },
  { label: 'Contact', href: '/contact', external: false },
  { label: 'Terms and conditions', href: 'https://delicatecourier.co.za/terms-%26-conditions', external: true },
  { label: 'Payment information', href: 'https://delicatecourier.co.za/payment-information', external: true },
  { label: 'Acceptable use policy', href: 'https://delicatecourier.co.za/acceptable-use-policy', external: true },
]

const SOCIALS = [
  { label: 'Instagram', href: 'https://www.instagram.com/delicatecourier' },
  { label: 'Facebook', href: 'https://www.facebook.com/delicatecourier' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@delicatecourier' },
]

export default function Footer() {
  return (
    <footer className="bg-[#0A0A0A] text-white">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-10 max-w-6xl mx-auto px-5 py-14">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="text-[18px] font-bold tracking-tight">Delicate Courier</span>
            <span className="flex gap-1">
              <span className="w-[7px] h-[7px] rounded-full bg-[#E84A8A]" />
              <span className="w-[7px] h-[7px] rounded-full bg-[#F4C430]" />
              <span className="w-[7px] h-[7px] rounded-full bg-[#7C5CFF]" />
            </span>
          </div>
          <p className="text-[14px] text-[#9A958E] leading-relaxed max-w-sm">
            Same-day courier for baked goods, fresh food, and flowers across Pretoria. Temperature controlled, handled with care.
          </p>
          <p className="text-[#7E7972] text-[12px] mt-5">Copyright Delicate Courier (Pty) Ltd. All rights reserved.</p>
        </div>

        <div>
          <h4 className="text-[13px] tracking-[0.05em] text-[#E84A8A] font-bold mb-4">Services</h4>
          <ul className="space-y-2.5">
            {SERVICE_LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="text-[14px] text-[#C9C4BC] hover:text-[#F7A8CE] transition-colors">{l.label}</a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-[13px] tracking-[0.05em] text-[#E84A8A] font-bold mb-4">Company</h4>
          <ul className="space-y-2.5">
            {COMPANY_LINKS.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="text-[14px] text-[#C9C4BC] hover:text-[#F7A8CE] transition-colors"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-[13px] tracking-[0.05em] text-[#E84A8A] font-bold mb-4">Connect</h4>
          <ul className="space-y-2.5">
            {SOCIALS.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-[14px] text-[#C9C4BC] hover:text-[#F7A8CE] transition-colors">{s.label}</a>
              </li>
            ))}
          </ul>
          <p className="text-[#9A958E] text-[13px] mt-5 leading-relaxed">
            14 Camellia Avenue,<br />Lynnwood Ridge, Pretoria
          </p>
          <a href="tel:+27785746727" className="block text-[13px] text-[#C9C4BC] hover:text-white mt-3">+27 78 574 6727</a>
          <a href="mailto:support@delicatecourier.co.za" className="block text-[13px] text-[#C9C4BC] hover:text-white">support@delicatecourier.co.za</a>
        </div>
      </div>
    </footer>
  )
}
