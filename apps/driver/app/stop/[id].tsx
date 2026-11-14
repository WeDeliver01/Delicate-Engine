import { useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverDay } from "@delicate/contracts";
import { SHIPMENT_STATUS_LABELS } from "@delicate/contracts";
import { api, ApiRequestError } from "../../src/lib/api";
import { currentPosition } from "../../src/lib/location";
import { CameraCapture } from "../../src/lib/capture";
import { submit, useOutbox } from "../../src/lib/outbox";
import { attemptId, pendingFor } from "../../src/lib/queue";
import { ArriveButton, StopActions } from "../../src/lib/stop-actions";
import { StatusControl } from "../../src/lib/status-control";
import { Badge, Button, C, Card, ErrorNote, Loading, s } from "../../src/lib/ui";

const REASONS = [
  { key: "recipient_unavailable", label: "Nobody there" },
  { key: "wrong_address", label: "Wrong address" },
  { key: "refused", label: "Refused" },
  { key: "damaged", label: "Damaged" },
  { key: "other", label: "Other" },
] as const;

/** The most photographs one delivery takes. The parcel, the door, the slip — three is plenty. */
const MAX_PHOTOS = 3;

/**
 * Deliver or fail one drop.
 *
 * Proof of delivery is a name and at least one photograph; the engine will not settle without
 * it. The submit goes through the outbox, so a delivery marked where there is no signal is
 * kept on the phone and sent when there is — the driver is told that is what happened, rather
 * than shown an error for a parcel that is already in the recipient's hands.
 */
export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const outbox = useOutbox();
  const day = useQuery({ queryKey: ["day"], queryFn: () => api<DriverDay>("/v1/driver/day") });
  const stop = useMemo(
    () =>
      [...(day.data?.stops ?? []), ...(day.data?.upcoming ?? [])].find((x) => x.shipmentId === id),
    [day.data, id],
  );
  const sending = pendingFor(outbox, { shipmentId: id });

  const [receivedBy, setReceivedBy] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [camera, setCamera] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["key"]>("recipient_unavailable");
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const afterSubmit = async (landed: boolean, what: string) => {
    await qc.invalidateQueries();
    if (!landed) {
      Alert.alert(
        "Saved on your phone",
        `There is no signal here. ${what} is recorded and will be sent the moment you are back in range.`,
      );
    }
    router.back();
  };

  const deliver = useMutation({
    mutationFn: async () => {
      const attempt = attemptId(Date.now());
      return submit({
        id: attempt,
        kind: "deliver",
        shipmentId: id,
        bookingId: stop?.bookingId ?? null,
        path: "/v1/driver/deliver",
        body: {
          shipmentId: id,
          receivedBy: receivedBy.trim(),
          photoDataUrl: photos[0] ?? null,
          photoDataUrls: photos.slice(1),
          note: note.trim() || null,
          location: await currentPosition(),
          attemptId: attempt,
        },
        label: `Delivered ${stop?.waybill ?? ""} to ${receivedBy.trim()}`,
      });
    },
    onSuccess: (res) => afterSubmit(res.landed, "The delivery"),
    onError,
  });

  const fail = useMutation({
    mutationFn: async () =>
      submit({
        id: attemptId(Date.now()),
        kind: "fail",
        shipmentId: id,
        bookingId: stop?.bookingId ?? null,
        path: "/v1/driver/fail",
        body: {
          shipmentId: id,
          reason,
          note: note.trim() || null,
          photoDataUrl: photos[0] ?? null,
          location: await currentPosition(),
        },
        label: `Failed attempt on ${stop?.waybill ?? ""}`,
      }),
    onSuccess: (res) => afterSubmit(res.landed, "The attempt"),
    onError,
  });

  if (day.isLoading) return <Loading />;
  if (!stop) return <ErrorNote message="This stop is no longer on your list." />;

  const upcoming = !!stop.slotDate && !!day.data && stop.slotDate > day.data.date;
  const canWork =
    !stop.done &&
    !sending &&
    (stop.status === "collected" ||
      stop.status === "in_transit" ||
      stop.status === "out_for_delivery");

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
        {stop.changed && (
          /* Loud on purpose. The driver read this address at the depot and is steering from
             memory; a quiet grey line is exactly what gets skipped past. */
          <Card style={{ borderColor: C.pink, borderWidth: 2, backgroundColor: "#FCEEF4" }}>
            <Text style={[s.h2, { color: "#C13B73" }]}>Changed since you were assigned</Text>
            <Text style={[s.body, { marginTop: 4 }]}>
              The {stop.changed.what.join(" and ")} {stop.changed.what.length > 1 ? "have" : "has"}{" "}
              been updated. What is shown below is current — check it before you set off.
            </Text>
          </Card>
        )}

        <Card>
          <View style={s.row}>
            <Badge
              label={
                sending ? "Sending…" : stop.status ? SHIPMENT_STATUS_LABELS[stop.status] : "Drop"
              }
              tone={
                sending
                  ? "neutral"
                  : stop.status === "out_for_delivery"
                    ? "warn"
                    : stop.status === "delivered"
                      ? "good"
                      : "neutral"
              }
            />
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
          {upcoming && (
            <Text style={[s.body, { marginTop: 8, color: C.muted }]}>
              Booked for {stop.slotDate}
              {stop.slotWindowKey ? ` · ${stop.slotWindowKey.replace(/_/g, " ")}` : ""}
            </Text>
          )}
        </Card>

        <StopActions stop={stop} target="recipient" />
        <ArriveButton stop={stop} />
        {!sending && <StatusControl stop={stop} />}

        {sending ? (
          <Card>
            <Text style={s.h2}>Waiting for signal</Text>
            <Text style={[s.body, { marginTop: 6 }]}>
              {sending.label} is saved on your phone and will be sent as soon as you are back in
              range. Nothing more to do here.
            </Text>
          </Card>
        ) : stop.status === "assigned" ? (
          <Card>
            <Text style={s.body}>
              Collect this parcel first. The delivery screen opens once it is in the van.
            </Text>
          </Card>
        ) : !canWork ? null : !failing ? (
          <Card>
            <Text style={s.h2}>Proof of delivery</Text>
            <Text style={[s.body, { marginTop: 4, color: C.muted }]}>
              Who took it, and a photo of the parcel where you left it. Add a second photo of the
              door or the slip if it helps.
            </Text>
            <View style={{ gap: 10, marginTop: 10 }}>
              <TextInput
                value={receivedBy}
                onChangeText={setReceivedBy}
                placeholder="Received by (name)"
                placeholderTextColor={C.muted}
                style={s.input}
              />
              <PhotoStrip
                photos={photos}
                onAdd={() => setCamera(true)}
                onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
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
                disabled={!receivedBy.trim() || photos.length === 0}
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
              <PhotoStrip
                photos={photos}
                onAdd={() => setCamera(true)}
                onRemove={(i) => setPhotos((p) => p.filter((_, j) => j !== i))}
                optional
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
        title={photos.length === 0 ? "Capture the parcel at the door" : "One more, if it helps"}
        onClose={() => setCamera(false)}
        onCaptured={(url) => setPhotos((p) => (p.length < MAX_PHOTOS ? [...p, url] : p))}
      />
    </KeyboardAvoidingView>
  );
}

/** The photos taken so far, each removable, and a button for the next one. */
function PhotoStrip({
  photos,
  onAdd,
  onRemove,
  optional = false,
}: {
  photos: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  optional?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      {photos.length > 0 && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {photos.map((url, i) => (
            <Pressable
              key={i}
              onPress={() =>
                Alert.alert("Remove this photo?", undefined, [
                  { text: "Keep", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => onRemove(i) },
                ])
              }
              style={{ flex: 1, aspectRatio: 1, borderRadius: 12, overflow: "hidden" }}
            >
              <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} />
            </Pressable>
          ))}
        </View>
      )}
      {photos.length < MAX_PHOTOS && (
        <Button
          label={
            photos.length === 0
              ? optional
                ? "Add a photo (optional)"
                : "Take a photo"
              : `Add another photo (${photos.length}/${MAX_PHOTOS})`
          }
          variant="secondary"
          onPress={onAdd}
        />
      )}
    </View>
  );
}
