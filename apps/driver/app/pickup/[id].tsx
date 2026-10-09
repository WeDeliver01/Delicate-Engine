import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverDay } from "@delicate/contracts";
import { SHIPMENT_STATUS_LABELS } from "@delicate/contracts";
import { api, ApiRequestError } from "../../src/lib/api";
import { currentPosition } from "../../src/lib/location";
import { StopActions } from "../../src/lib/stop-actions";
import { Badge, Button, C, Card, ErrorNote, Loading, s } from "../../src/lib/ui";

/**
 * A collection, opened.
 *
 * Collections used to be a single button on the day list, which was enough while the only
 * thing to do with one was tick it off. They are a stop like any other: somewhere to navigate
 * to, somebody to ring, and a sender who would like to know the driver is ten minutes out.
 *
 * Keyed on the booking, because one collection covers every parcel in it — the driver loads
 * them into the van together and ticks them off together.
 */
export default function PickupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const day = useQuery({ queryKey: ["day"], queryFn: () => api<DriverDay>("/v1/driver/day") });
  const stop = useMemo(
    () => day.data?.stops.find((x) => x.kind === "collection" && x.bookingId === id),
    [day.data, id],
  );

  const collect = useMutation({
    mutationFn: async () =>
      api("/v1/driver/collect", {
        method: "POST",
        json: { bookingId: id, location: await currentPosition() },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiRequestError ? e.message : "Could not reach the engine."),
  });

  if (day.isLoading) return <Loading />;
  if (!stop) return <ErrorNote message="This collection is no longer on your list." />;

  const waiting = stop.shipments.filter((x) => x.status === "assigned" || x.status === "booked");

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {stop.changed && (
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
          <Badge label="Collect" tone={stop.done ? "good" : "warn"} />
          <Text style={[s.mono, { fontSize: 12 }]}>{stop.bookingReference}</Text>
        </View>
        <Text style={[s.h2, { marginTop: 8 }]}>{stop.contact?.name ?? "Collection"}</Text>
        <Text style={s.body}>{stop.address.formatted}</Text>
        {stop.contact?.phone && (
          <Text style={[s.body, { color: C.muted, marginTop: 4 }]}>{stop.contact.phone}</Text>
        )}
        {stop.instructions && (
          <Text style={[s.body, { marginTop: 8, fontStyle: "italic" }]}>{stop.instructions}</Text>
        )}
      </Card>

      <Card>
        <Text style={s.label}>What to load</Text>
        <Text style={[s.body, { marginTop: 6 }]}>
          {stop.parcels.map((p) => `${p.quantity} x ${p.description ?? "parcel"}`).join(", ")}
        </Text>
        <View style={{ marginTop: 12, gap: 6 }}>
          {stop.shipments.map((x) => (
            <View key={x.shipmentId} style={s.row}>
              <Text style={[s.mono, { fontSize: 12 }]}>{x.waybill}</Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>
                {SHIPMENT_STATUS_LABELS[x.status]}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <StopActions stop={stop} target="collection" />

      {error && <ErrorNote message={error} />}

      {waiting.length > 0 ? (
        <Button
          label={`Collected all ${waiting.length}`}
          onPress={() => collect.mutate()}
          busy={collect.isPending}
        />
      ) : (
        <Card>
          <Text style={s.body}>Everything here is loaded. The drops are on your day list.</Text>
        </Card>
      )}
    </ScrollView>
  );
}
