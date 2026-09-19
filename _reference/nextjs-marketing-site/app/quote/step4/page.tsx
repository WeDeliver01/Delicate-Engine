'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import '../quote.css'
import { StepperProvider, useStepper } from '@/components/StepperContext'
import QuoteStepper from '@/components/QuoteStepper'
import QuoteHeader from '@/components/QuoteHeader'
import { QUOTE_CONSTANTS } from '@/lib/constants'

const COST_PER_KM = QUOTE_CONSTANTS.COST_PER_KM
const MARGIN = QUOTE_CONSTANTS.MARGIN

const generateTrackingNumber = () => {
  const prefix = 'DC'
  const date = new Date()
  const year = date.getFullYear().toString().slice(-2)
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `${prefix}${year}${month}${day}-${random}`
}

const generateReference = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// ── Separate component that uses useStepper ─────────────────────
function Step4Content() {
  const router = useRouter()
  const { markStepCompleted } = useStepper()

  const [routeData, setRouteData] = useState<any>(null)
  const [parcelData, setParcelData] = useState<any>(null)
  const [contactData, setContactData] = useState<any>(null)
  const [revenue, setRevenue] = useState(0)
  const [rateInfo, setRateInfo] = useState<{ cost_per_km: number; margin: number; clientName: string | null; isClientLink: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalWeight, setTotalWeight] = useState(0)
  const [quoteNumber, setQuoteNumber] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [quoteDate, setQuoteDate] = useState('')
  const [quoteExpiry, setQuoteExpiry] = useState('')

  // Resolve the correct rate: default, or this client's card if they opened a link.
  useEffect(() => {
    let token: string | null = null
    try { token = localStorage.getItem('quoteClientToken') } catch {}
    const qs = token ? `?c=${encodeURIComponent(token)}` : ''
    fetch(`/api/rate-context/${qs}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) setRateInfo({ cost_per_km: d.cost_per_km, margin: d.margin, clientName: d.client_name, isClientLink: d.is_client_link })
        else setRateInfo({ cost_per_km: COST_PER_KM, margin: MARGIN, clientName: null, isClientLink: false })
      })
      .catch(() => setRateInfo({ cost_per_km: COST_PER_KM, margin: MARGIN, clientName: null, isClientLink: false }))
  }, [])

  // Recompute the displayed price whenever route, weight, or resolved rate changes.
  useEffect(() => {
    const cpk = rateInfo ? rateInfo.cost_per_km : COST_PER_KM
    const m = rateInfo ? rateInfo.margin : MARGIN
    const distance = routeData?.totalDistance || 0
    const calculatedRevenue = distance > 0
      ? (distance * cpk) / (1 - m)
      : Math.max((totalWeight || 1) * cpk / (1 - m), 100)
    setRevenue(calculatedRevenue)
  }, [routeData, totalWeight, rateInfo])

  useEffect(() => {
    const savedRouteData = localStorage.getItem('quoteRouteData')
    const savedParcelData = localStorage.getItem('quoteParcelData')
    const savedContactData = localStorage.getItem('quoteContactData')

    if (!savedRouteData) { router.push('/quote/step1'); return }
    if (!savedParcelData) { router.push('/quote/step2'); return }
    if (!savedContactData) { router.push('/quote/step3'); return }

    let route, parcel, contact
    try {
      route = JSON.parse(savedRouteData)
    } catch (e) {
      console.error('Failed to parse route data:', e)
      router.push('/quote/step1')
      return
    }
    try {
      parcel = JSON.parse(savedParcelData)
    } catch (e) {
      console.error('Failed to parse parcel data:', e)
      router.push('/quote/step2')
      return
    }
    try {
      contact = JSON.parse(savedContactData)
    } catch (e) {
      console.error('Failed to parse contact data:', e)
      router.push('/quote/step3')
      return
    }

    setRouteData(route)
    setParcelData(parcel)
    setContactData(contact)

    const weight = parcel.parcels.reduce((sum: number, p: any) => sum + (p.weight || 0), 0)
    setTotalWeight(weight)

    // Price is computed in a dedicated effect below, using server-resolved rates.

    const today = new Date()
    const expiryDate = new Date()
    expiryDate.setDate(today.getDate() + 7)
    setQuoteNumber(generateReference())
    setTrackingNumber(generateTrackingNumber())
    setQuoteDate(today.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }))
    setQuoteExpiry(expiryDate.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' }))
  }, [router])

  const generateBarcodeSVG = (text: string, faded = false) => {
    const opacity = faded ? 0.18 : 1
    const bars: string[] = []
    let x = 0
    const totalWidth = 280
    const height = 40
    const seed = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0)

    for (let i = 0; i < 80; i++) {
      const pseudo = ((seed * (i + 1) * 6364136223846793005 + 1442695040888963407) >>> 0) % 100
      const isWide = pseudo < 30
      const width = isWide ? 4 : 2
      const isGap = pseudo > 65
      if (!isGap) {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#1a1a1a" opacity="${opacity}"/>`)
      }
      x += width + 1
      if (x > totalWidth) break
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height + 18}" viewBox="0 0 ${totalWidth} ${height + 18}">
        ${bars.join('')}
        <text x="${totalWidth / 2}" y="${height + 14}" text-anchor="middle" font-family="monospace" font-size="11" fill="#1a1a1a" opacity="${opacity}" letter-spacing="2">${text}</text>
      </svg>
    `
  }

  const getQuoteHTML = (fadedBarcode = false) => {
    const barcodeSVG = generateBarcodeSVG(trackingNumber, fadedBarcode)
    const barcodeBase64 = `data:image/svg+xml;base64,${btoa(decodeURIComponent(encodeURIComponent(barcodeSVG)))}`

    const parcelRows = parcelData?.parcels.map((p: any, i: number) => `
      <tr style="border-bottom: 1px solid #eeeeee;">
        <td style="padding: 10px 8px; font-size: 13px;">${i + 1} parcel</td>
        <td style="padding: 10px 8px; font-size: 13px;">${p.weight} kg</td>
        <td style="padding: 10px 8px; font-size: 13px;">${p.weight} kg</td>
        <td style="padding: 10px 8px; font-size: 13px;">Standard</td>
        <td style="padding: 10px 8px; font-size: 13px; text-align: right;">R ${revenue.toFixed(2)}</td>
        <td style="padding: 10px 8px; font-size: 13px; text-align: center;">-</td>
        <td style="padding: 10px 8px; font-size: 13px; text-align: right; font-weight: 600;">R ${revenue.toFixed(2)}</td>
      </tr>
    `).join('') || ''

    const parcelSpecs = parcelData?.parcels.map((p: any) =>
      `${p.length} x ${p.width} x ${p.height} cm, ${p.weight} kg x${parcelData.parcels.length}`
    ).join(', ') || 'No parcels'

    const collectionAddress = routeData?.pickup?.address || routeData?.pickup?.name || 'Not specified'
    const deliveryAddresses = routeData?.dropoffs?.map((d: any) => d.address || d.name).join('<br>') || 'Not specified'

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Delicate Courier Quote ${trackingNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      color: #222222;
      font-size: 13px;
      line-height: 1.5;
    }
    .page { max-width: 794px; margin: 0 auto; background: #ffffff; padding: 36px 40px; }

    .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #E84A8A; padding-bottom: 20px; }
    .header-left { display: flex; align-items: flex-start; gap: 16px; }
    .logo-wrap img { width: 72px; height: 72px; object-fit: contain; }
    .quote-title h1 { font-size: 28px; font-weight: 700; color: #222222; letter-spacing: 3px; line-height: 1; }
    .quote-title p { font-size: 13px; color: #666666; margin-top: 4px; }
    .barcode-wrap { text-align: right; }
    .barcode-wrap img { display: block; margin-left: auto; }

    .info-block { display: flex; gap: 40px; padding: 20px 0; border-bottom: 1px solid #eeeeee; }
    .info-col { flex: 1; }
    .info-label { font-size: 11px; font-weight: 700; color: #E84A8A; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px; }
    .info-value { font-size: 13px; color: #222222; line-height: 1.6; }
    .info-value strong { font-weight: 600; }
    .bank-box { background: #fafafa; border: 1px solid #eeeeee; border-radius: 6px; padding: 10px 12px; margin-top: 10px; }
    .bank-box .info-label { margin-bottom: 6px; }
    .bank-box p { font-size: 12px; color: #333333; margin: 2px 0; line-height: 1.5; }

    .addr-parcel-row { 
      display: flex; 
      gap: 0; 
      border: 1px solid #a5a5a5;
      border-radius: 4px;
      overflow: hidden;
    }
    .addr-box { 
      flex: 1; 
      padding: 18px;
      border-right: 1px solid #a5a5a5; 
    }
    .addr-box:last-child { 
      border-right: none; 
    }
    .addr-box:not(:first-child) { 
      padding-left: 18px;
    }
    .addr-box .info-label { 
      margin-bottom: 6px; 
    }
    .addr-box p { 
      font-size: 13px; 
      color: #333333; 
      line-height: 1.6; 
    }

    .table-section { padding: 20px 0 0; }
    .table-section h3 { font-size: 14px; font-weight: 600; color: #222222; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f5f5f5; border-bottom: 2px solid #dddddd; }
    th { padding: 10px 8px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #555555; }
    th:last-child, td:last-child { text-align: right; }
    .totals-row { background: #fafafa; border-top: 2px solid #E84A8A; }
    .totals-row td { padding: 12px 8px; font-weight: 700; font-size: 14px; color: #222222; }
    .totals-row td:last-child { color: #E84A8A; font-size: 15px; }

    .footer { 
      margin-top: 28px; 
      padding-top: 16px; 
      border-top: 1px solid #eeeeee; 
      display: flex; 
      justify-content: center;
      align-items: center; 
      gap: 20px;
    }
    .footer p { 
      font-size: 11px; 
      color: #999999; 
    }
    .footer-right { 
      text-align: center; 
    }

    @media print { body { background: white; } .page { padding: 20px; } }
  </style>
</head>
<body>
<div class="page">

  <div class="header-top">
    <div class="header-left">
      <div class="logo-wrap">
        <img src="/images/logo.png" alt="Delicate Courier Logo">
      </div>
      <div class="quote-title">
        <h1>QUOTE</h1>
        <p>New shipment</p>
      </div>
    </div>
    <div class="barcode-wrap">
      <img src="${barcodeBase64}" width="220" height="58" alt="Barcode ${trackingNumber}">
    </div>
  </div>

  <div class="info-block">
    <div class="info-col">
      <div class="info-label">Address</div>
      <div class="info-value">
        <strong>Delicate Courier (Pty) Ltd</strong><br>
        14 Camellia Avenue<br>
        Office 8 @ Circa<br>
        Lynnwood Ridge<br>
        0081
      </div>
      <div style="margin-top: 12px;">
        <div class="info-label">Contact no.</div>
        <div class="info-value">+27 78 574 6727</div>
      </div>
      <div style="margin-top: 10px;">
        <div class="info-label">Registration no.</div>
        <div class="info-value">2025/056408/07</div>
      </div>
      <div style="margin-top: 10px;">
        <div class="info-label">VAT no.</div>
        <div class="info-value" style="color: #999;">-</div>
      </div>
    </div>

    <div class="info-col">
      <div class="info-label">Account</div>
      <div class="info-value">Admin (ADM001)</div>

      <div style="margin-top: 12px;">
        <div class="info-label">Date</div>
        <div class="info-value">${quoteDate}</div>
      </div>

      <div style="margin-top: 10px;">
        <div class="info-label">Quote expires</div>
        <div class="info-value">${quoteExpiry}</div>
      </div>

      <div class="bank-box">
        <div class="info-label">Bank details</div>
        <p>Bank: FIRST NATIONAL BANK</p>
        <p>Account type: CHEQUE</p>
        <p>Branch code: 230145</p>
        <p>Account number: 63136576676</p>
        <p>Reference: ADM001/${quoteNumber}</p>
      </div>
    </div>
  </div>

  <div class="addr-parcel-row">
    <div class="addr-box">
      <div class="info-label">Collection address</div>
      <p>${collectionAddress}</p>
    </div>
    <div class="addr-box">
      <div class="info-label">Delivery address</div>
      <p>${deliveryAddresses}</p>
    </div>
    <div class="addr-box">
      <div class="info-label">Parcels</div>
      <p>${parcelSpecs}</p>
    </div>
  </div>

  <div class="table-section">
    <table>
      <thead>
        <tr>
          <th>Parcel(s)</th>
          <th>Actual Weight</th>
          <th>Charged Weight</th>
          <th>Service level</th>
          <th style="text-align:right;">Subtotal</th>
          <th style="text-align:center;">VAT</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${parcelRows}
        <tr class="totals-row">
          <td colspan="4"><strong>TOTALS</strong></td>
          <td style="text-align:right;"><strong>R ${revenue.toFixed(2)}</strong></td>
          <td style="text-align:center; font-weight:700;">-</td>
          <td style="text-align:right;"><strong>R ${revenue.toFixed(2)}</strong></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <div class="footer-right">
      <p>Collection cut-off: 13:00</p>
      Valid for 7 days
      <p>+27 78 574 6727</p>
      <p>support@delicatecourier.co.za</p>
      <p>Thank you for choosing Delicate Courier</p>
    </div>
  </div>

</div>
</body>
</html>`
  }

  const handleDownloadPDF = async () => {
    if (typeof window === 'undefined') return

    setLoading(true)
    setError('')

    // html2pdf relies on DOM APIs and canvas; keep everything strictly client-side.
    const tempDiv = document.createElement('div')
    try {
      localStorage.setItem('quoteStep4Complete', 'true')
      markStepCompleted(4)

      const depotAddr = '14 Camellia Avenue, Lynnwood Ridge, Pretoria'
      const pickupAddr = routeData?.pickup?.address?.trim() || depotAddr
      const totalDist = routeData?.totalDistance || 10

      const pickupCoords = routeData?.pickup?.coords
      const validDropoffs = routeData?.dropoffs?.filter((d: any) => d?.address?.trim()) || []


      const haversineKm = (coord1: [number, number], coord2: [number, number]) => {
        const R = 6371
        const [lat1, lon1] = coord1
        const [lat2, lon2] = coord2
        const dLat = ((lat2 - lat1) * Math.PI) / 180
        const dLon = ((lon2 - lon1) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }

      const DEPOT_COORDS: [number, number] = [-25.765757, 28.288375]

      // Compute real leg distances when coords are available; otherwise fall back to the previous multiplier approach.
      const canComputeDistances =
        Array.isArray(pickupCoords) && pickupCoords.length >= 2 &&
        validDropoffs.every((d: any) => Array.isArray(d?.coords) && d.coords.length >= 2)

      const round2 = (n: number) => +n.toFixed(2)

      let depot_to_bakery_km = round2(totalDist * 0.3)
      let bakery_to_first_customer_km = round2(totalDist * 0.35)
      let customerDistances: number[] = validDropoffs.map((_: any, i: number) =>
        round2(i === 0 ? totalDist * 0.30 : totalDist * 0.35)
      )

      if (canComputeDistances) {
        const pickupLatLng: [number, number] = [pickupCoords[0], pickupCoords[1]]

        depot_to_bakery_km = round2(haversineKm(DEPOT_COORDS, pickupLatLng))

        // Distances from bakery/pickup to each dropoff are modeled via customers[].distance_from_previous_km
        // backend expects: distance_from_previous_km for each customer in order.
        const coordsList: [number, number][] = [pickupLatLng, ...validDropoffs.map((d: any) => [d.coords[0], d.coords[1]])]

        // distance_from_previous_km for customers[0..n-1] = distance between coordsList[i] -> coordsList[i+1]
        customerDistances = coordsList
          .slice(0, coordsList.length - 1)
          .map((from, i) => round2(haversineKm(from, coordsList[i + 1])))

        // For compatibility with existing payload fields, map:
        //   bakery_to_first_customer_km = depot_to_bakery_km? (no) -> distance from pickup to first dropoff
        bakery_to_first_customer_km = customerDistances[0] ?? round2(totalDist * 0.35)

        const computedTotal = round2(
          depot_to_bakery_km + bakery_to_first_customer_km +
            customerDistances.slice(1).reduce((a, b) => a + b, 0)
        )

        const diff = Math.abs(computedTotal - round2(totalDist))
        if (diff > 0.05) {
          console.warn('[Step4] Computed leg distances differ from route.totalDistance beyond tolerance.', {
            computedTotal,
            routeTotal: round2(totalDist),
            diff,
          })
          // Keep computed legs (primary goal alignment with what backend stores). Displayed revenue still uses route.totalDistance.
        }
      } else {
        console.warn('[Step4] Missing coords for route legs; using fallback multipliers for leg distances.')
      }

      const customers = validDropoffs.map((d: any, i: number) => ({
        name: d.name || `Dropoff ${i + 1}`,
        address: d.address.trim(),
        distance_from_previous_km: customerDistances[i] ?? (i === 0 ? round2(totalDist * 0.30) : round2(totalDist * 0.35)),
        coords_lat: d.coords?.[0] || null,
        coords_lng: d.coords?.[1] || null,
      }))


      if (customers.length === 0) {
        customers.push({
          address: pickupAddr,
          distance_from_previous_km: round2(totalDist * 0.30),
          coords_lat: null,
          coords_lng: null
        })
      }

      const payload = {
        quote_number: quoteNumber,
        tracking_number: trackingNumber,
        depot_address: depotAddr,
        bakery_address: pickupAddr,
        end_depot_address: depotAddr,
        depot_to_bakery_km,
        bakery_to_first_customer_km,
        margin_percent: rateInfo?.margin ?? MARGIN,
        client_token: (() => { try { return localStorage.getItem('quoteClientToken') } catch { return null } })(),
        total_weight_kg: totalWeight,
        pickup_coords_lat: pickupCoords?.[0] || null,
        pickup_coords_lng: pickupCoords?.[1] || null,
        sender_name: contactData?.senderName || null,
        sender_email: contactData?.senderEmail || null,
        sender_phone: contactData?.senderPhone || null,
        recipient_name: contactData?.recipientName || null,
        recipient_email: contactData?.recipientEmail || null,
        recipient_phone: contactData?.recipientPhone || null,
        liability_cover: !!contactData?.liabilityCover,
        early_collection: !!contactData?.earlyCollection,
        signature_on_delivery: !!contactData?.signatureOnDelivery,
        wedding_venue: !!contactData?.weddingVenue,
        delivery_directions: contactData?.deliveryDirections || null,
        // deliveryDirections is an optional free-text field captured on Step 3

        special_instructions: contactData?.specialInstructions || null,

        parcels: parcelData?.parcels || [],
        customers,
      }


      const response = await fetch('/api/quotes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || JSON.stringify(errorData) || `HTTP ${response.status}`)
      }

      const html2pdf = (await import('html2pdf.js')).default

      tempDiv.innerHTML = getQuoteHTML(false)
      document.body.appendChild(tempDiv)




      const opt = {
        margin: 0,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 3, useCORS: true, logging: false, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      } as any




      html2pdf().set(opt).from(tempDiv).save().then(() => {
        document.body.removeChild(tempDiv)
      })

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred while saving'
      setError(errorMessage)
      alert(`Error: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(getQuoteHTML(false))
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    }
  }

  const handleStartOver = () => {
    localStorage.removeItem('quoteRouteData')
    localStorage.removeItem('quoteParcelData')
    localStorage.removeItem('quoteContactData')
    localStorage.removeItem('quoteStep1Complete')
    localStorage.removeItem('quoteStep2Complete')
    localStorage.removeItem('quoteStep3Complete')
    localStorage.removeItem('quoteStep4Complete')
    localStorage.removeItem('quoteCompletedSteps')
    router.push('/quote/step1')
  }

  const handleEditRoute = () => router.push('/quote/step1')
  const handleEditParcels = () => router.push('/quote/step2')
  const handleEditContact = () => router.push('/quote/step3')

  if (!routeData || !parcelData || !contactData) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#ECEAE6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading quote...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <QuoteHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full pt-6 px-4 pb-20">
        <QuoteStepper />

        <h2 className="text-2xl font-semibold mb-6">Review Quote</h2>

        {rateInfo?.isClientLink && rateInfo.clientName && (
          <div className="bg-gray-900 text-white rounded-xl p-3 mb-4 text-center text-sm">
            Pricing for <strong>{rateInfo.clientName}</strong>. Your account rates are applied.
          </div>
        )}
        <div className="bg-[#0A0A0A] rounded-xl p-6 mb-6 text-white text-center">
          <p className="text-sm opacity-90 mb-1">Your Final Quote</p>
          <p className="text-5xl font-bold font-mono">R {revenue.toFixed(2)}</p>
          <p className="text-xs opacity-80 mt-2">Including all taxes and fees</p>
        </div>

        <div className="bg-gray-50 border rounded-xl p-4 mb-6">
          <h3 className="font-semibold mb-3">Order Summary</h3>
          <div className="text-sm text-gray-600 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Collection</p>
              <p className="font-medium text-gray-800">{routeData.pickup.name}</p>
              <p className="text-gray-500">{routeData.pickup.address || 'Address not entered'}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {routeData.dropoffs.length > 1 ? `Deliveries (${routeData.dropoffs.length})` : 'Delivery'}
              </p>
              <div className="space-y-1.5">
                {routeData.dropoffs.map((dropoff: any, index: number) => (
                  <div key={index} className="flex gap-2">
                    {routeData.dropoffs.length > 1 && (
                      <span className="text-xs font-semibold text-[#E84A8A] mt-0.5 w-4 shrink-0">{index + 1}.</span>
                    )}
                    <div>
                      {dropoff.name && <p className="font-medium text-gray-800">{dropoff.name}</p>}
                      <p className="text-gray-500">{dropoff.address || 'Address not entered'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Parcels ({parcelData.parcels.length})
              </p>
              <div className="space-y-1">
                {parcelData.parcels.map((p: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    {parcelData.parcels.length > 1 && (
                      <span className="text-xs font-semibold text-[#E84A8A] mt-0.5 w-4 shrink-0">{i + 1}.</span>
                    )}
                    <div>
                      <p className="font-medium text-gray-800">{p.type}</p>
                      <p className="text-gray-500 text-xs">{p.length}×{p.width}×{p.height} cm · {p.weight} kg · {p.category}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Contact Details</h3>
            <button onClick={handleEditContact} className="text-xs text-[#E84A8A] hover:underline">Edit</button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Sender</p>
              <p className="font-medium">{contactData.senderName}</p>
              <p className="text-xs text-gray-500">{contactData.senderEmail}</p>
              <p className="text-xs text-gray-500">{contactData.senderPhone}</p>
            </div>
            <div>
              <p className="text-gray-600 mb-1">Recipient</p>
              <p className="font-medium">{contactData.recipientName}</p>
              <p className="text-xs text-gray-500">{contactData.recipientEmail}</p>
              <p className="text-xs text-gray-500">{contactData.recipientPhone}</p>
            </div>
          </div>
          {(contactData.liabilityCover || contactData.earlyCollection || contactData.signatureOnDelivery || contactData.weddingVenue) && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-gray-600 text-sm mb-2">Special Requests</p>
              <div className="flex flex-wrap gap-2">

                {contactData.liabilityCover && <span className="text-xs bg-gray-100 px-2 py-1 rounded">Liability Cover</span>}
                {contactData.earlyCollection && <span className="text-xs bg-gray-100 px-2 py-1 rounded">Early Collection</span>}
                {contactData.signatureOnDelivery && <span className="text-xs bg-gray-100 px-2 py-1 rounded">Signature on Delivery</span>}
                {contactData.weddingVenue && <span className="text-xs bg-gray-100 px-2 py-1 rounded">Wedding Venue</span>}
              </div>
              <div className="mt-3">
                <p className="text-gray-600 text-sm mb-2">Delivery Directions / Special Instructions</p>
                <p className="text-sm text-gray-800">
                  {contactData?.deliveryDirections?.trim()
                    ? contactData.deliveryDirections
                    : '-'}
                </p>
              </div>
            </div>
          )}

          {!(contactData.liabilityCover || contactData.earlyCollection || contactData.signatureOnDelivery || contactData.weddingVenue) && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-gray-600 text-sm mb-2">Delivery Directions / Special Instructions</p>
              <p className="text-sm text-gray-800">
                {contactData?.deliveryDirections?.trim()
                  ? contactData.deliveryDirections
                  : '-'}
              </p>
            </div>
          )}

        </div>

{/* download buttons section or div */}
         <div className="flex flex-col gap-3">
           <div className="flex gap-4">
             <button
               onClick={handleDownloadPDF}
               disabled={loading}
               className="flex-1 border border-[#ECEAE6] text-[#E84A8A]  py-3 rounded-xl font-medium hover:bg-[#0A0A0A]"
             >
               {loading ? 'Processing...' : 'Download PDF'}
             </button>
             <button
               onClick={handlePrint}
               className="flex-1 border border-[#ECEAE6] text-[#0A0A0A] py-3 rounded-xl font-medium hover:bg-[#0A0A0A]"
             >
               Print
             </button>
           </div>
           <div className="flex gap-4">
             <button
               onClick={handleStartOver}
               className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
             >
               Start Over
             </button>
           </div>
         </div>

        <div className="flex justify-center gap-6 mt-6 pt-4 border-t border-gray-200">
          <button onClick={handleEditRoute} className="text-sm text-gray-500 hover:text-[#E84A8A] transition-colors">Edit Route</button>
          <span className="text-gray-300">|</span>
          <button onClick={handleEditParcels} className="text-sm text-gray-500 hover:text-[#E84A8A] transition-colors">Edit Parcels</button>
          <span className="text-gray-300">|</span>
          <button onClick={handleEditContact} className="text-sm text-gray-500 hover:text-[#E84A8A] transition-colors">Edit Contact</button>
        </div>
      </main>
    </>
  )
}

// ── Main Page ────────────────────────────────────────────────────
export default function Step4Page() {
  return (
    <StepperProvider currentStep={4}>
      <div className="flex flex-col min-h-screen bg-gray-50">
        <Step4Content />
      </div>
    </StepperProvider>
  )
}