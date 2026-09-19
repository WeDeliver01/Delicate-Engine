'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import '../quote.css'
import { StepperProvider, useStepper } from '@/components/StepperContext'
import QuoteStepper from '@/components/QuoteStepper'
import QuoteHeader from '@/components/QuoteHeader'

// ── Toggle Switch Component ──────────────────────────────────────
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (val: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0
        ${checked ? 'bg-[#0A0A0A]' : 'bg-gray-200'}`}
      style={{ width: '52px', height: '28px' }}
    >
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
          ${checked ? 'translate-x-7' : 'translate-x-1'}`}
      >
        {!checked && (
          <svg className="w-2.5 h-2.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {checked && (
          <svg className="w-2.5 h-2.5 text-[#E84A8A]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </button>
  )
}

// ── Info Badge ───────────────────────────────────────────
function InfoBadge({ tip }: { tip: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label="More information"
        className="w-5 h-5 rounded-full bg-gray-400 hover:bg-[#0A0A0A] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-[#E84A8A] transition-colors"
      >
        i
      </button>
      {show && (
        <span 
          className="absolute bottom-7 left-1/2 -translate-x-1/2 w-56 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 z-50 shadow-lg pointer-events-none"
          role="tooltip"
        >
          {tip}
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></span>
        </span>
      )}
    </span>
  )
}

// ── Input shared style ───────────────────────────────────────────
const inputClass = `w-full border border-[#EFECE7] rounded-lg px-3 py-2.5 bg-[#FFFFFF] text-sm text-gray-800
  focus:outline-none focus:ring-2 focus:ring-[#E84A8A] focus:border-[#ECEAE6]
  hover:border-[#ECEAE6] transition-colors placeholder-gray-300`

// ── Separate component that uses useStepper ─────────────────────
function Step3Content() {
  const router = useRouter()
  const { markStepCompleted } = useStepper()

  const [routeData, setRouteData] = useState<any>(null)
  const [parcelData, setParcelData] = useState<any>(null)

  const [senderName, setSenderName] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [senderPhone, setSenderPhone] = useState('')
  const [senderAltPhone, setSenderAltPhone] = useState('')

  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [recipientAltPhone, setRecipientAltPhone] = useState('')

  // Pre-fill the sender (collection party) from the client link, without overriding edits.
  useEffect(() => {
    let token: string | null = null
    try { token = localStorage.getItem('quoteClientToken') } catch {}
    if (!token) return
    fetch(`/api/rate-context/?c=${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d || !d.is_client_link) return
        if (d.sender_name) setSenderName(prev => prev || d.sender_name)
        if (d.sender_email) setSenderEmail(prev => prev || d.sender_email)
        if (d.sender_phone) setSenderPhone(prev => prev || d.sender_phone)
      })
      .catch(() => {})
  }, [])

  const [liabilityCover, setLiabilityCover] = useState(false)
  const [declaredValue, setDeclaredValue] = useState('')
  const [earlyCollection, setEarlyCollection] = useState(false)
  const [signatureOnDelivery, setSignatureOnDelivery] = useState(false)
  const [weddingVenue, setWeddingVenue] = useState(false)
  const [deliveryDirections, setDeliveryDirections] = useState('')


  const [canProceed, setCanProceed] = useState(false)

  useEffect(() => {
    const savedRouteData = localStorage.getItem('quoteRouteData')
    const savedParcelData = localStorage.getItem('quoteParcelData')

    if (!savedRouteData) { router.push('/quote/step1'); return }
    if (!savedParcelData) { router.push('/quote/step2'); return }

    try {
      setRouteData(JSON.parse(savedRouteData))
    } catch (e) {
      console.error('Failed to parse route data:', e)
      router.push('/quote/step1')
    }
    
    try {
      setParcelData(JSON.parse(savedParcelData))
    } catch (e) {
      console.error('Failed to parse parcel data:', e)
      router.push('/quote/step2')
    }

    const savedContactData = localStorage.getItem('quoteContactData')
    if (savedContactData) {
      try {
        const contact = JSON.parse(savedContactData)
        setSenderName(contact.senderName || '')
        setSenderEmail(contact.senderEmail || '')
        setSenderPhone(contact.senderPhone || '')
        setSenderAltPhone(contact.senderAltPhone || '')
        // (Sender may still be pre-filled from the client link below if left blank.)
        setRecipientName(contact.recipientName || '')
        setRecipientEmail(contact.recipientEmail || '')
        setRecipientPhone(contact.recipientPhone || '')
        setRecipientAltPhone(contact.recipientAltPhone || '')
      } catch (e) {
        console.error('Failed to parse contact data:', e)
      }
    }
  }, [router])

  useEffect(() => {
    const valid =
      senderName.trim() !== '' &&
      senderEmail.trim() !== '' &&
      senderPhone.trim() !== '' &&
      recipientName.trim() !== '' &&
      recipientEmail.trim() !== '' &&
      recipientPhone.trim() !== ''
    setCanProceed(valid)
  }, [senderName, senderEmail, senderPhone, recipientName, recipientEmail, recipientPhone])


const buildContactData = () => ({
    senderName,
    senderEmail,
    senderPhone,
    senderAltPhone,
    recipientName,
    recipientEmail,
    recipientPhone,
    recipientAltPhone,
    liabilityCover,
    declaredValue,
    earlyCollection,
    signatureOnDelivery,
    weddingVenue,
    deliveryDirections,
  })


  const handleNext = () => {
    if (!canProceed) return
    localStorage.setItem('quoteContactData', JSON.stringify(buildContactData()))
    localStorage.setItem('quoteStep3Complete', 'true')
    markStepCompleted(3)
    router.push('/quote/step4')
  }

  const handleBack = () => {
    localStorage.setItem('quoteContactData', JSON.stringify(buildContactData()))
    router.push('/quote/step2')
  }

  if (!routeData || !parcelData) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#ECEAE6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  const totalWeight = parcelData.parcels.reduce((sum: number, p: any) => sum + (p.weight || 0), 0)

  return (
    <>
      <QuoteHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full pt-6 px-4 pb-20">
        <QuoteStepper />

        <h2 className="text-2xl font-semibold mb-6">Contact & Special Requests</h2>

        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-[#FFFFFF] border border-[#EFECE7] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-[#E84A8A]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="font-semibold">Sender Details</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Full Name <span className="text-[#E84A8A]">*</span></label>
              <input type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)}
                placeholder="John Doe" className={inputClass} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Email Address <span className="text-[#E84A8A]">*</span></label>
              <input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="john@example.com" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Mobile Number <span className="text-[#E84A8A]">*</span></label>
                <input type="tel" value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)}
                  placeholder="+27 82 123 4567" className={inputClass} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Alternative Number</label>
                <input type="tel" value={senderAltPhone} onChange={(e) => setSenderAltPhone(e.target.value)}
                  placeholder="Optional" className={inputClass} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-full bg-[#FFFFFF] border border-[#EFECE7] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-[#E84A8A]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="font-semibold">Recipient Details</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Full Name <span className="text-[#E84A8A]">*</span></label>
              <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Jane Smith" className={inputClass} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Email Address <span className="text-[#E84A8A]">*</span></label>
              <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="jane@example.com" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Mobile Number <span className="text-[#E84A8A]">*</span></label>
                <input type="tel" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="+27 82 123 4567" className={inputClass} />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Alternative Number</label>
                <input type="tel" value={recipientAltPhone} onChange={(e) => setRecipientAltPhone(e.target.value)}
                  placeholder="Optional" className={inputClass} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[#F8F6F3]">
            <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <h3 className="font-semibold">Special requests</h3>
          </div>

          <div className="mb-5">
            <p className="text-sm font-bold text-gray-800 mb-3">Do you want to add liability cover?</p>
            <div className="flex items-center gap-3">
              <Toggle checked={liabilityCover} onChange={setLiabilityCover} />
              <span className="text-sm text-gray-700">
                Liability cover – <span className="font-bold">rate depends on declared value</span>
              </span>
            </div>

            {liabilityCover && (
              <div className="mt-3 ml-0">
                <label className="text-sm font-medium text-gray-700 block mb-1.5">
                  Declare value <span className="text-gray-400 font-normal">(max: R 80,000)</span>
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">R</span>
                  <input
                    type="number"
                    value={declaredValue}
                    onChange={(e) => {
                      const val = Math.min(Number(e.target.value), 80000)
                      setDeclaredValue(val > 0 ? String(val) : '')
                    }}
                    placeholder="0"
                    min="0"
                    max="80000"
                    className={`${inputClass} pl-7`}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-bold text-gray-800 mb-3">Do you have any special requests?</p>
            <div className="space-y-3.5">
              <div className="flex items-center gap-3">
                <Toggle checked={earlyCollection} onChange={setEarlyCollection} />
                <span className="text-sm text-gray-700 flex items-center gap-1.5 flex-wrap">
                  Early collection – <span className="font-bold">rate shown on next screen</span>
                  <InfoBadge tip="Early collection is available before our standard 13:00 cut-off. Rate will be confirmed on the quote screen." />
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Toggle checked={signatureOnDelivery} onChange={setSignatureOnDelivery} />
                <span className="text-sm text-gray-700 flex items-center gap-1.5 flex-wrap">
                  Signature on delivery – <span className="font-bold">R 5.00</span>
                  <InfoBadge tip="Recipient must sign upon delivery. A proof of delivery document will be provided." />
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Toggle checked={weddingVenue} onChange={setWeddingVenue} />
                <span className="text-sm text-gray-700 flex items-center gap-1.5 flex-wrap">
                  Wedding venue delivery – <span className="font-bold">rate shown on next screen</span>
                  <InfoBadge tip="Deliveries to wedding venues may include additional handling fees based on venue access requirements." />
                </span>
              </div>
            </div>

            <div className="mt-5">
              <label
                className="text-sm font-medium text-gray-700 block mb-1.5"
                htmlFor="deliveryDirections"
              >
                Delivery Directions / Special Instructions
              </label>
              <textarea
                id="deliveryDirections"
                value={deliveryDirections}
                onChange={(e) => setDeliveryDirections(e.target.value)}
                placeholder="e.g. Gate code, leave with security, call on arrival"
                className={`${inputClass} min-h-[110px] resize-y`}
              />
            </div>
          </div>
        </div>


        <div className="bg-[#FFFFFF] border border-[#EFECE7] rounded-lg p-3 mb-6">
          <p className="text-xs text-[#E84A8A]">
            Additional charges may apply for special requests. Final pricing will be shown on the quote summary page.
          </p>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleBack}
            className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canProceed}
            className="flex-1 bg-[#E84A8A] text-white py-3 rounded-lg font-medium hover:bg-[#E84A8A]
              transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Review Quote
          </button>
        </div>
      </main>
    </>
  )
}

// ── Main Page ────────────────────────────────────────────────────
export default function Step3Page() {
  return (
    <StepperProvider currentStep={3}>
      <div className="flex flex-col min-h-screen">
        <Step3Content />
      </div>
    </StepperProvider>
  )
}