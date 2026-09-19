'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

interface StepperContextType {
  completedSteps: number[]
  currentStep: number
  markStepCompleted: (step: number) => void
  resetSteps: () => void
}

const StepperContext = createContext<StepperContextType | undefined>(undefined)

const STORAGE_KEY = 'quoteCompletedSteps'

function getValidCompletedSteps(currentStep: number): number[] {
  const validCompleted: number[] = []

  // Only check previous steps if currentStep > 1
  for (let i = 1; i < currentStep; i++) {
    const hasRouteData = !!localStorage.getItem('quoteRouteData')
    const hasParcelData = !!localStorage.getItem('quoteParcelData')
    const hasContactData = !!localStorage.getItem('quoteContactData')

    if (i === 1 && hasRouteData) {
      validCompleted.push(i)
    } else if (i === 2 && hasRouteData && hasParcelData) {
      validCompleted.push(i)
    } else if (i === 3 && hasRouteData && hasParcelData && hasContactData) {
      validCompleted.push(i)
    } else if (i === 4) {
      // Step 4 completion is determined by user action, not data
      if (localStorage.getItem('quoteStep4Complete') === 'true' && hasRouteData && hasParcelData && hasContactData) {
        validCompleted.push(i)
      }
    }
  }

  return validCompleted
}

export function StepperProvider({
  children,
  currentStep
}: {
  children: ReactNode
  currentStep: number
}) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([])

  useEffect(() => {
    // Get valid completed steps based on actual data presence
    const validCompleted = getValidCompletedSteps(currentStep)
    setCompletedSteps(validCompleted)

    // Update localStorage to reflect validated state
    if (validCompleted.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validCompleted))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [currentStep])

  const markStepCompleted = (step: number) => {
    setCompletedSteps(prev => {
      if (prev.includes(step)) return prev
      const newCompleted = [...prev, step].sort((a, b) => a - b)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newCompleted))
      return newCompleted
    })
  }

  const resetSteps = () => {
    setCompletedSteps([])
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('quoteStep1Complete')
    localStorage.removeItem('quoteStep2Complete')
    localStorage.removeItem('quoteStep3Complete')
    localStorage.removeItem('quoteStep4Complete')
  }

  return (
    <StepperContext.Provider value={{ completedSteps, currentStep, markStepCompleted, resetSteps }}>
      {children}
    </StepperContext.Provider>
  )
}

export function useStepper() {
  const context = useContext(StepperContext)
  if (!context) {
    throw new Error('useStepper must be used within StepperProvider')
  }
  return context
}