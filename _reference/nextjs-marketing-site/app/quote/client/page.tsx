'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import QuoteHeader from '@/components/QuoteHeader'

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_HEADERS = {
  'Accept-Language': 'en',
  'User-Agent': 'DelicateCourierQuoteGenerator/1.0 (contact@delicatecourier.co.za)',
}

const WHATSAPP_NUMBER = '27639018835'

type RateContext = {
  is_client_link: boolean
  has_preset_collection: boolean
  client_name: string | null
  collection_name: string
  collection_address: string
}

type Estimate = {
  distance_km: number
  price: number
}

function DeliveryAutocomplete({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([])
      return
    }
    clearTimeout(timerRef.current!)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: value.trim(), format: 'json', limit: '5' })
        const res = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, { headers: NOMINATIM_HEADERS })
        const data = await res.json()
        setSuggestions(data.map((i: any) => i.display_name))
      } catch {
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    }, 500)
    return () => clearTimeout(timerRef.current!)
  }, [value])

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShow(true)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        placeholder="Enter your delivery address"
        className="w-full border border-gray-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#E84A8A] disabled:bg-gray-50"
      />
      {show && value.trim() && (suggestions.length > 0 || loading) && (
        <div className="absolute z-20 w-full mt-1 bg-white border rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-gray-500">Searching...</div>
          ) : (
            suggestions.map((s, i) => (
              <div
                key={i}
                onMouseDown={() => {
                  onChange(s)
                  setShow(false)
                }}
                className="p-3 cursor-pointer hover:bg-gray-50 text-sm border-b last:border-0"
              >
                {s}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function ClientQuotePage() {
  const router = useRouter()

  const [token, setToken] = useState<string | null>(null)
  const [ctx, setCtx] = useState<RateContext | null>(null)
  const [loadingCtx, setLoadingCtx] = useState(true)

  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [error, setError] = useState('')

  // Resolve the client link and its preset collection.
  useEffect(() => {
    // Token must come from the link itself, never from prior local state,
    // so a stale token can't price a client against the wrong account.
    let t: string | null = null
    try {
      t = new URLSearchParams(window.location.search).get('c')
      if (t) localStorage.setItem('quoteClientToken', t)
    } catch {}

    if (!t) {
      router.replace('/quote/step1')
      return
    }
    setToken(t)

    fetch(`/api/rate-context/?c=${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RateContext | null) => {
        if (!d || !d.is_client_link) {
          // Not a valid client link, fall back to the standard wizard.
          router.replace('/quote/step1')
          return
        }
        if (!d.has_preset_collection) {
          // No preset collection on this link, use the full wizard with their rate.
          router.replace(`/quote/step1?c=${encodeURIComponent(t!)}`)
          return
        }
        setCtx(d)
        setLoadingCtx(false)
      })
      .catch(() => {
        router.replace('/quote/step1')
      })
  }, [router])

  // Recalculating distance/address invalidates the previous price.
  useEffect(() => {
    setEstimate(null)
  }, [deliveryAddress])

  const handleGetPrice = async () => {
    if (!ctx || !token) return
    if (!deliveryAddress.trim()) {
      setError('Please enter your delivery address')
      return
    }
    setEstimating(true)
    setError('')
    setEstimate(null)
    try {
      const res = await fetch('/api/estimate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickup_address: ctx.collection_address,
          delivery_address: deliveryAddress.trim(),
          client_token: token,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Could not calculate a price (HTTP ${res.status})`)
      }
      setEstimate({ distance_km: data.distance_km, price: data.price })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not calculate a price')
    } finally {
      setEstimating(false)
    }
  }

  const buildWhatsappLink = () => {
    if (!ctx || !estimate) return '#'
    const lines = [
      'Hey, I want to book this.',
      '',
      ctx.client_name ? `Client: ${ctx.client_name}` : '',
      `Collection: ${ctx.collection_name}, ${ctx.collection_address}`,
      `Delivery: ${deliveryAddress.trim()}`,
      `Distance: ${estimate.distance_km} km`,
      `Price: R ${estimate.price.toFixed(2)}`,
    ].filter(Boolean)
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`
  }

  if (loadingCtx || !ctx) {
    return (
      <div className="flex flex-col min-h-screen">
        <QuoteHeader />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Loading your quote...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#FAF8F5]">
      <QuoteHeader />

      <main className="flex-1 w-full max-w-xl mx-auto px-4 pt-8 pb-20">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-[#0A0A0A]">
            {ctx.client_name ? `Hi ${ctx.client_name}` : 'Get a quote'}
          </h2>
          <p className="text-gray-600 mt-1">
            Enter your delivery address to see the price, then book in one tap.
          </p>
        </div>

        {/* Collection (preset, locked) */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-[#E84A8A] font-semibold mb-2">
            Collection
          </p>
          <p className="font-medium text-[#0A0A0A]">{ctx.collection_name}</p>
          <p className="text-sm text-gray-700">{ctx.collection_address}</p>
          <p className="text-xs text-gray-500 mt-2">
            Set for your account, no need to enter it.
          </p>
        </div>

        {/* Delivery */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-[#E84A8A] font-semibold mb-2">
            Delivery
          </p>
          <DeliveryAutocomplete value={deliveryAddress} onChange={setDeliveryAddress} />
          <button
            type="button"
            onClick={handleGetPrice}
            disabled={estimating}
            className="mt-4 w-full bg-[#0A0A0A] text-white rounded-full py-3 font-medium hover:bg-black/80 transition-colors disabled:opacity-60"
          >
            {estimating ? 'Calculating...' : 'Get price'}
          </button>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>

        {/* Price + Book */}
        {estimate && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-gray-600">Total price</span>
              <span className="text-3xl font-bold text-[#0A0A0A] font-mono">
                R {estimate.price.toFixed(2)}
              </span>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Approx. {estimate.distance_km} km from collection to delivery.
            </p>
            <a
              href={buildWhatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-[#E84A8A] text-white rounded-full py-3.5 font-semibold hover:bg-[#d43d7b] transition-colors"
            >
              Book on WhatsApp
            </a>
            <p className="text-xs text-gray-500 mt-3 text-center">
              Opens WhatsApp with your booking details ready to send.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
