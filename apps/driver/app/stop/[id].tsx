import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverDay } from "@delicate/contracts";
import { api, ApiRequestError } from "../../src/lib/api";
import { currentPosition } from "../../src/lib/location";
import { CameraCapture } from "../../src/lib/capture";
import { Badge, Button, C, Card, ErrorNote, Loading, s } from "../../src/lib/ui";

const REASONS = [
  { key: "recipient_unavailable", label: "Nobody there" },
  { key: "wrong_address", label: "Wrong address" },
  { key: "refused", label: "Refused" },
  { key: "damaged", label: "Damaged" },
  { key: "other", label: "Other" },
] as const;

/** Deliver or fail one drop. Proof of delivery is required before the engine will settle. */
export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const day = useQuery({ queryKey: ["day"], queryFn: () => api<DriverDay>("/v1/driver/day") });
  const stop = useMemo(() => day.data?.stops.find((x) => x.shipmentId === id), [day.data, id]);

  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["key"]>("recipient_unavailable");
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const deliver = useMutation({
    mutationFn: async () =>
      api("/v1/driver/deliver", {
        method: "POST",
        json: {
          shipmentId: id,
          receivedBy: receivedBy.trim(),
          photoDataUrl: photo,
          note: note.trim() || null,
          location: await currentPosition(),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
    onError,
  });

  const fail = useMutation({
    mutationFn: async () =>
      api("/v1/driver/fail", {
        method: "POST",
        json: {
          shipmentId: id,
          reason,
          note: note.trim() || null,
          photoDataUrl: photo,
          location: await currentPosition(),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
    onError,
  });

  if (day.isLoading) return <Loading />;
  if (!stop) return <ErrorNote message="This stop is no longer on your list." />;

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
          <View style={s.row}>
            <Badge label={stop.status ?? "drop"} />
            <Text style={[s.mono, { fontSize: 12 }]}>{stop.waybill}</Text>
          </View>
          <Text style={[s.h2, { marginTop: 8 }]}>{stop.contact?.name}</Text>
          <Text style={s.body}>{stop.address.formatted}</Text>
          {stop.contact?.phone && (
            <Text style={[s.body, { color: C.muted, marginTop: 4 }]}>{stop.contact.phone}</Text>
          )}
          {stop.instructions && (
            <Text style={[s.body, { marginTop: 8, fontStyle: "italic" }]}>{stop.instructions}</Text>
          )}
          <Text style={[s.body, { marginTop: 8, color: C.muted }]}>
            {stop.parcels.map((p) => `${p.quantity} x ${p.description ?? "parcel"}`).join(", ")}
          </Text>
        </Card>

        {!failing ? (
          <Card>
            <Text style={s.h2}>Proof of delivery</Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              <TextInput
                value={receivedBy}
                onChangeText={setReceivedBy}
                placeholder="Received by (name)"
                placeholderTextColor={C.muted}
                style={s.input}
              />
              <Button
                label={photo ? "Photo captured - retake" : "Take a photo"}
                variant="secondary"
                onPress={() => setCamera(true)}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional)"
                placeholderTextColor={C.muted}
                style={s.input}
              />
              {error && <ErrorNote message={error} />}
              <Button
                label="Mark delivered"
                onPress={() => deliver.mutate()}
                busy={deliver.isPending}
                disabled={!receivedBy.trim() || !photo}
              />
              <Button
                label="Could not deliver"
                variant="danger"
                onPress={() => {
                  setFailing(true);
                  setError(null);
                }}
              />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={s.h2}>What happened?</Text>
            <View style={{ gap: 8, marginTop: 10 }}>
              {REASONS.map((r) => (
                <Button
                  key={r.key}
                  label={`${reason === r.key ? "(*) " : "( ) "}${r.label}`}
                  variant="secondary"
                  onPress={() => setReason(r.key)}
                />
              ))}
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional)"
                placeholderTextColor={C.muted}
                style={s.input}
              />
              <Button
                label={photo ? "Photo captured" : "Add a photo (optional)"}
                variant="secondary"
                onPress={() => setCamera(true)}
              />
              {error && <ErrorNote message={error} />}
              <Button
                label="Report failed attempt"
                variant="danger"
                onPress={() => fail.mutate()}
                busy={fail.isPending}
              />
              <Button label="Back" variant="secondary" onPress={() => setFailing(false)} />
            </View>
          </Card>
        )}
      </ScrollView>

      <CameraCapture
        visible={camera}
        title="Capture the parcel at the door"
        onClose={() => setCamera(false)}
        onCaptured={setPhoto}
      />
    </KeyboardAvoidingView>
  );
}
