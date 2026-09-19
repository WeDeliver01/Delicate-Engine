'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import '../quote.css'
import { StepperProvider, useStepper } from '@/components/StepperContext'
import QuoteStepper from '@/components/QuoteStepper'
import QuoteHeader from '@/components/QuoteHeader'

const PACKAGE_TYPES = [
  { value: 'Custom Parcel', label: 'Custom Parcel' },
  { value: 'Xsmall Cake Box', label: 'Xsmall Cake Box' },
  { value: 'Custom Dessert Box', label: 'Custom Dessert Box' },
  { value: 'Small Cake Box', label: 'Small Cake Box' },
  { value: 'Medium Cake Box', label: 'Medium Cake Box' },
  { value: 'Medium Wedding Cake', label: 'Medium Wedding Cake' },
  { value: 'Deli Cake box', label: 'Deli Cake Box' },
  { value: 'Medium Cheesecake Box', label: 'Medium Cheesecake Box' },
  { value: 'Large Cheesecake Box', label: 'Large Cheesecake Box' },
  { value: 'Cookie Box of 6', label: 'Cookie Box of 6' },
  { value: 'Cookie Box of 12', label: 'Cookie Box of 12' },
  { value: 'Cake Tasting Box', label: 'Cake Tasting Box' },
  { value: 'Lunch Cake Box', label: 'Lunch Cake Box' },
  { value: '2 Tier Cake', label: '2 Tier Cake' },
  { value: '3 Tier Cake', label: '3 Tier Cake' },
  { value: 'Other', label: 'Other' },
]

const PARCEL_CATEGORIES = [
  { value: '2 Tier Cake', label: '2 Tier Cake' },
  { value: '3 Tier Cake', label: '3 Tier Cake' },
  { value: 'Brownies', label: 'Brownies' },
  { value: 'Cake Tasting', label: 'Cake Tasting' },
  { value: 'Cheesecake', label: 'Cheesecake' },
  { value: 'Cupcakes', label: 'Cupcakes' },
  { value: 'Deli Cake', label: 'Deli Cake' },
  { value: 'Doughnuts', label: 'Doughnuts' },
  { value: 'Freshly Prepared Platters', label: 'Freshly Prepared Platters' },
  { value: 'Lunchbox Cake', label: 'Lunchbox Cake' },
  { value: 'Macarons', label: 'Macarons' },
  { value: 'Pasteries', label: 'Pasteries' },
  { value: 'Single Tier Cake', label: 'Single Tier Cake' },
  { value: 'Other', label: 'Other' },
]

interface Parcel {
  id: number
  type: string
  length: number
  width: number
  height: number
  weight: number
  category: string
}

// ── Custom Dropdown ──────────────────────────────────────────────
function CustomSelect({
  value,
  options,
  placeholder = 'Select...',
  isOpen,
  onToggle,
  onSelect,
}: {
  value: string
  options: { value: string; label: string }[]
  placeholder?: string
  isOpen: boolean
  onToggle: () => void
  onSelect: (val: string) => void
}) {
  const selected = options.find(o => o.value === value)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (isOpen && listRef.current && value) {
      const activeItem = listRef.current.querySelector('[data-selected="true"]') as HTMLElement
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [isOpen, value])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between border rounded-lg px-3 py-2.5 bg-[#FFFFFF] text-sm text-left
          focus:outline-none focus:ring-2 focus:ring-[#E84A8A] transition-colors
          ${isOpen ? 'border-[#ECEAE6] ring-2 ring-[#E84A8A]' : 'border-[#EFECE7] hover:border-[#ECEAE6]'}`}
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-[#E84A8A] flex-shrink-0 ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <ul
          ref={listRef}
          className="absolute z-50 mt-1 w-full bg-white border border-[#EFECE7] rounded-lg shadow-lg max-h-52 overflow-y-auto"
        >
          {options.map(option => {
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                data-selected={isSelected}
                onClick={() => onSelect(option.value)}
                className={`px-3 py-2.5 text-sm cursor-pointer transition-colors flex items-center justify-between
                  ${isSelected
                    ? 'bg-[#FFFFFF] text-[#E84A8A] font-medium'
                    : 'text-gray-700 hover:bg-[#FFFFFF] hover:text-[#E84A8A]'
                  }`}
              >
                {option.label}
                {isSelected && (
                  <svg className="w-3.5 h-3.5 text-[#E84A8A] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Separate component that uses useStepper ─────────────────────
function Step2Content() {
  const router = useRouter()
  const { markStepCompleted } = useStepper()

  const [routeData, setRouteData] = useState<any>(null)
  const [parcels, setParcels] = useState<Parcel[]>([
    { id: 1, type: 'Custom Parcel', length: 0, width: 0, height: 0, weight: 0, category: '' }
  ])
  const [canProceed, setCanProceed] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdown(null)
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openDropdown])

  useEffect(() => {
    const savedData = localStorage.getItem('quoteRouteData')
    if (!savedData) {
      router.push('/quote/step1')
      return
    }
    try {
      setRouteData(JSON.parse(savedData))
    } catch (e) {
      console.error('Failed to parse route data:', e)
      router.push('/quote/step1')
    }
  }, [router])

  const getNextId = () => Math.max(...parcels.map(p => p.id), 0) + 1

  const addParcel = () => {
    setParcels([...parcels, {
      id: getNextId(),
      type: 'Custom Parcel',
      length: 0,
      width: 0,
      height: 0,
      weight: 0,
      category: ''
    }])
  }

  const removeParcel = (id: number) => {
    if (parcels.length > 1) {
      setParcels(parcels.filter(p => p.id !== id))
    }
  }

  const updateParcel = (id: number, field: keyof Parcel, value: any) => {
    setParcels(parcels.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  useEffect(() => {
    const allValid = parcels.every(parcel =>
      parcel.type &&
      parcel.length > 0 &&
      parcel.width > 0 &&
      parcel.height > 0 &&
      parcel.weight > 0 &&
      parcel.category
    )
    setCanProceed(allValid)
  }, [parcels])

  const handleNext = () => {
    if (!canProceed) return
    const parcelData = {
      parcels: parcels.map(p => ({
        id: p.id,
        type: p.type,
        length: p.length,
        width: p.width,
        height: p.height,
        weight: p.weight,
        category: p.category
      }))
    }
    localStorage.setItem('quoteParcelData', JSON.stringify(parcelData))
    localStorage.setItem('quoteStep2Complete', 'true')
    markStepCompleted(2)
    router.push('/quote/step3')
  }

  const handleBack = () => router.push('/quote/step1')

  if (!routeData) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#ECEAE6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <QuoteHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full pt-6 px-4 pb-20">
        <QuoteStepper />

        <h2 className="text-2xl font-semibold mb-6">Parcel Details</h2>

        <div className="bg-white border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Parcel Details</h3>
            <span className="bg-[#F8F6F3] text-[#b57eb5] border border-[#EFECE7] px-2.5 py-1 rounded-full text-xs font-medium">
              {parcels.length} Parcel{parcels.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-6">
            {parcels.map((parcel, index) => (
              <div key={parcel.id} className="border-t pt-5 first:border-t-0 first:pt-0">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm font-semibold text-[#E84A8A]">Parcel {index + 1}</span>
                  {parcels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeParcel(parcel.id)}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-2 py-1 rounded-md transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="mb-4">
                  <label className="text-sm font-medium text-gray-700 block mb-1.5">Package Type</label>
                  <CustomSelect
                    value={parcel.type}
                    options={PACKAGE_TYPES}
                    placeholder="Select package type"
                    isOpen={openDropdown === `type-${parcel.id}`}
                    onToggle={() => setOpenDropdown(
                      openDropdown === `type-${parcel.id}` ? null : `type-${parcel.id}`
                    )}
                    onSelect={(val) => {
                      updateParcel(parcel.id, 'type', val)
                      setOpenDropdown(null)
                    }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {(['length', 'width', 'height'] as const).map((dim) => (
                    <div key={dim}>
                      <label className="text-sm font-medium text-gray-700 block mb-1.5 capitalize">{dim} (cm)</label>
                      <input
                        type="number"
                        value={parcel[dim] || ''}
                        onChange={(e) => updateParcel(parcel.id, dim, parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        min="1"
                        step="0.1"
                        className="w-full border border-[#EFECE7] rounded-lg px-3 py-2.5 bg-[#FFFFFF] text-sm text-gray-800
                          focus:outline-none focus:ring-2 focus:ring-[#E84A8A] focus:border-[#ECEAE6]
                          hover:border-[#ECEAE6] transition-colors placeholder-gray-300"
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1.5">Weight (kg)</label>
                    <input
                      type="number"
                      value={parcel.weight || ''}
                      onChange={(e) => updateParcel(parcel.id, 'weight', parseFloat(e.target.value) || 0)}
                      placeholder="0.0"
                      min="0.1"
                      step="0.1"
                      className="w-full border border-[#EFECE7] rounded-lg px-3 py-2.5 bg-[#FFFFFF] text-sm text-gray-800
                        focus:outline-none focus:ring-2 focus:ring-[#E84A8A] focus:border-[#ECEAE6]
                        hover:border-[#ECEAE6] transition-colors placeholder-gray-300"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1.5">Category</label>
                    <CustomSelect
                      value={parcel.category}
                      options={PARCEL_CATEGORIES}
                      placeholder="Select category"
                      isOpen={openDropdown === `category-${parcel.id}`}
                      onToggle={() => setOpenDropdown(
                        openDropdown === `category-${parcel.id}` ? null : `category-${parcel.id}`
                      )}
                      onSelect={(val) => {
                        updateParcel(parcel.id, 'category', val)
                        setOpenDropdown(null)
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addParcel}
            className="mt-5 w-full border border-dashed border-[#ECEAE6] text-[#E84A8A]
              hover:bg-[#FFFFFF] py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            + Add another parcel
          </button>
        </div>

        <div className="bg-[#FFFFFF] border border-[#EFECE7] rounded-lg p-3 mb-6">
          <p className="text-xs text-[#E84A8A]">
            Additional costs may occur if incorrect parcel dimensions and weight are submitted.
            Pricing will be calculated based on total weight and distance.
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
            Next
          </button>
        </div>
      </main>
    </>
  )
}

// ── Main Page ────────────────────────────────────────────────────
export default function Step2Page() {
  return (
    <StepperProvider currentStep={2}>
      <div className="flex flex-col min-h-screen">
        <Step2Content />
      </div>
    </StepperProvider>
  )
}