import { useCallback, useEffect, useState } from "react";
import {
  fetchActiveTrip,
  type ActiveTripResponse,
  type DriverTripDto,
  type DriverTripStopDto,
  type DriverTripExpenseDto,
} from "@/lib/driver-api";

interface State {
  trip: DriverTripDto | null;
  stops: DriverTripStopDto[];
  expenses: DriverTripExpenseDto[];
  loading: boolean;
  error: string | null;
}

export function useDriverTripSession(authed: boolean) {
  const [state, setState] = useState<State>({ trip: null, stops: [], expenses: [], loading: true, error: null });

  const refresh = useCallback(async () => {
    if (!authed) {
      setState({ trip: null, stops: [], expenses: [], loading: false, error: null });
      return;
    }
    try {
      const data: ActiveTripResponse = await fetchActiveTrip();
      setState({ trip: data.trip, stops: data.stops, expenses: data.expenses, loading: false, error: null });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load trip";
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [authed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setLocalTrip = useCallback((trip: DriverTripDto | null) => {
    setState((s) => ({ ...s, trip }));
  }, []);

  const addLocalStop = useCallback((stop: DriverTripStopDto) => {
    setState((s) => ({ ...s, stops: [...s.stops, stop] }));
  }, []);

  const addLocalExpense = useCallback((exp: DriverTripExpenseDto) => {
    setState((s) => ({ ...s, expenses: [...s.expenses, exp] }));
  }, []);

  const clear = useCallback(() => {
    setState({ trip: null, stops: [], expenses: [], loading: false, error: null });
  }, []);

  const fuelTotal = state.expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.amount || 0), 0);
  const litresTotal = state.expenses.filter((e) => e.expenseType === "fuel").reduce((s, e) => s + Number(e.litres || 0), 0);

  return {
    ...state,
    refresh,
    setLocalTrip,
    addLocalStop,
    addLocalExpense,
    clear,
    fuelTotal,
    litresTotal,
  };
}
