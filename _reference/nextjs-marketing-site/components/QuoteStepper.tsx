'use client'

import { useStepper } from './StepperContext'

const STEPS = [
  { n: 1, label: 'Route' },
  { n: 2, label: 'Parcels' },
  { n: 3, label: 'Contact' },
  { n: 4, label: 'Quote' }
]

export default function QuoteStepper() {
  const { completedSteps, currentStep } = useStepper()

  return (
    <div className="flex justify-between items-center mb-8 px-2">
      {STEPS.map((step, index) => {
        const isCompleted = completedSteps.includes(step.n)
        const isActive = step.n === currentStep

        return (
          <div key={step.n} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all
                  ${isActive
                    ? 'bg-white border-[#ECEAE6] text-[#E84A8A]'
                    : isCompleted
                      ? 'bg-[#0A0A0A] border-[#ECEAE6] text-white'
                      : 'bg-white border-gray-300 text-gray-400'
                  }`}
              >
                {isCompleted && !isActive ? '✓' : step.n}
              </div>

              <span className={`text-xs font-medium mt-2 transition-colors
                ${(isActive || isCompleted) ? 'text-[#E84A8A]' : 'text-gray-500'}`}>
                {step.label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div className={`flex-1 h-[3px] mx-3 mt-4 transition-colors
                ${isCompleted ? 'bg-[#0A0A0A]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}