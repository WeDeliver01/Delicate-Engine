import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../src/lib/api";
import { C, Card, Loading, rands, s } from "../src/lib/ui";

interface Me {
  driver: { fullName: string };
  owedEarningsCents: number;
  owedFuelCents: number;
}

/** What the office owes the driver. Payouts and fuel loads are executed by finance. */
export default function Earnings() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/driver/me") });
  if (me.isLoading) return <Loading />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={s.label}>Earnings owed</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>{rands(me.data?.owedEarningsCents ?? 0)}</Text>
        <Text style={[s.body, { color: C.muted, marginTop: 6 }]}>
          Accrued from every delivery you complete. The office pays this out on the agreed cycle.
        </Text>
      </Card>
      <Card>
        <Text style={s.label}>Fuel owed to your card</Text>
        <Text style={[s.h1, { marginTop: 4 }]}>{rands(me.data?.owedFuelCents ?? 0)}</Text>
        <Text style={[s.body, { color: C.muted, marginTop: 6 }]}>
          Calculated from the actual distance you drove. Finance loads this to your fuel card.
        </Text>
      </Card>
      <View style={{ padding: 8 }}>
        <Text style={[s.body, { color: C.muted, textAlign: "center" }]}>
          Every amount here comes from delivered shipments and is recorded in the company ledger.
        </Text>
      </View>
    </ScrollView>
  );
}
