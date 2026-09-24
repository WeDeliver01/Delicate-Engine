import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FuelLog } from "@delicate/contracts";
import { api, ApiRequestError } from "../src/lib/api";
import { CameraCapture } from "../src/lib/capture";
import { Button, C, Card, ErrorNote, rands, s } from "../src/lib/ui";

export default function Fuel() {
  const router = useRouter();
  const qc = useQueryClient();
  const logs = useQuery({ queryKey: ["fuel"], queryFn: () => api<FuelLog[]>("/v1/driver/fuel") });
  const [litres, setLitres] = useState("");
  const [amount, setAmount] = useState("");
  const [odometer, setOdometer] = useState("");
  const [station, setStation] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/driver/fuel", {
        method: "POST",
        json: {
          litres: Number(litres),
          amountCents: Math.round(Number(amount) * 100),
          odometerKm: odometer ? Number(odometer) : null,
          station: station.trim() || null,
          receiptDataUrl: receipt,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Card>
          <Text style={s.h2}>New fill-up</Text>
          <Text style={[s.body, { color: C.muted, marginTop: 4 }]}>
            Fuel is loaded to your card by the office; this record keeps the books straight.
          </Text>
          <TextInput
            value={litres}
            onChangeText={setLitres}
            placeholder="Litres"
            placeholderTextColor={C.muted}
            keyboardType="decimal-pad"
            style={[s.input, { marginTop: 12 }]}
          />
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount paid (R)"
            placeholderTextColor={C.muted}
            keyboardType="decimal-pad"
            style={[s.input, { marginTop: 10 }]}
          />
          <TextInput
            value={odometer}
            onChangeText={setOdometer}
            placeholder="Odometer (optional)"
            placeholderTextColor={C.muted}
            keyboardType="decimal-pad"
            style={[s.input, { marginTop: 10 }]}
          />
          <TextInput
            value={station}
            onChangeText={setStation}
            placeholder="Station (optional)"
            placeholderTextColor={C.muted}
            style={[s.input, { marginTop: 10 }]}
          />
          <Button
            label={receipt ? "Receipt captured - retake" : "Photograph the receipt"}
            variant="secondary"
            onPress={() => setCamera(true)}
            style={{ marginTop: 10 }}
          />
          {error && <ErrorNote message={error} />}
          <Button
            label="Save fuel log"
            onPress={() => save.mutate()}
            busy={save.isPending}
            disabled={!litres || !amount}
            style={{ marginTop: 10 }}
          />
        </Card>

        <Card>
          <Text style={s.h2}>Recent</Text>
          {logs.data?.length ? (
            logs.data.map((l) => (
              <Text key={l.id} style={[s.body, { marginTop: 8 }]}>
                {new Date(l.createdAt).toLocaleDateString("en-ZA")} · {l.litres} L ·{" "}
                {rands(l.amountCents)}
                {l.station ? ` · ${l.station}` : ""}
                {l.hasReceipt ? " · receipt" : ""}
              </Text>
            ))
          ) : (
            <Text style={[s.body, { color: C.muted, marginTop: 8 }]}>No fill-ups logged yet.</Text>
          )}
        </Card>
      </ScrollView>
      <CameraCapture
        visible={camera}
        title="Photograph the receipt"
        onClose={() => setCamera(false)}
        onCaptured={setReceipt}
      />
    </KeyboardAvoidingView>
  );
}
