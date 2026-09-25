import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DriverDay, DriverStop, Shift } from "@delicate/contracts";
import { api, ApiRequestError } from "../src/lib/api";
import { setToken } from "../src/lib/auth";
import {
  currentPosition,
  requestPermissions,
  startTracking,
  stopTracking,
} from "../src/lib/location";
import { Badge, Button, C, Card, ErrorNote, Loading, rands, s } from "../src/lib/ui";

interface Me {
  driver: { id: string; fullName: string };
  owedEarningsCents: number;
  owedFuelCents: number;
}

/** The driver's day: shift control at the top, then the stops in order. */
export default function Today() {
  const qc = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [odometer, setOdometer] = useState("");
  const [ending, setEnding] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/driver/me") });
  const day = useQuery({
    queryKey: ["day"],
    queryFn: () => api<DriverDay>("/v1/driver/day"),
    refetchInterval: 60_000,
  });
  const invalidate = () => qc.invalidateQueries();
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const startShift = useMutation({
    mutationFn: async () => {
      const perms = await requestPermissions();
      if (!perms.foreground)
        throw new ApiRequestError({
          statusCode: 0,
          code: "no_permission",
          message: "Location permission is needed to work a shift.",
        });
      const location = await currentPosition();
      const shift = await api<Shift>("/v1/driver/shift/start", {
        method: "POST",
        json: { odometerKm: Number(odometer), location },
      });
      if (perms.background) await startTracking();
      return shift;
    },
    onSuccess: () => {
      setOdometer("");
      setError(null);
      invalidate();
    },
    onError,
  });

  const endShift = useMutation({
    mutationFn: async () => {
      const location = await currentPosition();
      await stopTracking();
      return api<Shift>("/v1/driver/shift/end", {
        method: "POST",
        json: { odometerKm: Number(odometer), location },
      });
    },
    onSuccess: () => {
      setOdometer("");
      setEnding(false);
      setError(null);
      invalidate();
    },
    onError,
  });

  const collect = useMutation({
    mutationFn: async (bookingId: string) =>
      api("/v1/driver/collect", {
        method: "POST",
        json: { bookingId, location: await currentPosition() },
      }),
    onSuccess: invalidate,
    onError,
  });

  if (me.isLoading || day.isLoading) return <Loading />;
  if (me.error) return <ErrorNote message={(me.error as Error).message} />;

  const shift = day.data?.shift ?? null;
  const open = shift?.status === "open";
  const stops = day.data?.stops ?? [];

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={day.isRefetching}
          onRefresh={() => day.refetch()}
          tintColor={C.pink}
        />
      }
    >
      <Card>
        <View style={s.row}>
          <View>
            <Text style={s.label}>{day.data?.date}</Text>
            <Text style={s.h2}>{me.data?.driver.fullName}</Text>
          </View>
          <Badge
            label={open ? "On shift" : shift?.status === "closed" ? "Shift closed" : "Off shift"}
            tone={open ? "good" : "neutral"}
          />
        </View>

        {!open && shift?.status !== "closed" && (
          <View style={{ marginTop: 14, gap: 10 }}>
            <Text style={s.body}>Enter your odometer reading to start.</Text>
            <TextInput
              value={odometer}
              onChangeText={setOdometer}
              placeholder="Odometer (km)"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              style={s.input}
            />
            <Button
              label="Start shift"
              onPress={() => startShift.mutate()}
              busy={startShift.isPending}
              disabled={!odometer}
            />
          </View>
        )}

        {open && (
          <View style={{ marginTop: 14, gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button
                label="Log fuel"
                variant="secondary"
                onPress={() => router.push("/fuel")}
                style={{ flex: 1 }}
              />
              <Button
                label="End shift"
                variant="danger"
                onPress={() => setEnding(true)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
        {shift?.status === "closed" && (
          <Text style={[s.body, { marginTop: 10 }]}>Shift closed. See you tomorrow.</Text>
        )}
      </Card>

      {error && <ErrorNote message={error} />}

      {stops.length === 0 ? (
        <Card>
          <Text style={s.h2}>No stops yet</Text>
          <Text style={[s.body, { marginTop: 6 }]}>
            {open
              ? "Dispatch will assign work as bookings come in. Pull down to refresh."
              : "Start your shift to receive work."}
          </Text>
        </Card>
      ) : (
        <>
          {day.data?.route && day.data.route.savedKm > 0 && (
            <Card>
              <Text style={s.body}>
                {stops.length} stops · about {day.data.route.totalKm} km, ordered to save{" "}
                {day.data.route.savedKm} km on the run.
              </Text>
            </Card>
          )}
          {stops.map((stop, i) => (
            <StopCard
              key={`${stop.kind}-${stop.shipmentId ?? stop.bookingId}-${i}`}
              stop={stop}
              disabled={!open}
              onCollect={() => collect.mutate(stop.bookingId)}
              busy={collect.isPending}
            />
          ))}
        </>
      )}

      <Link href="/earnings" asChild>
        <Pressable>
          <Card>
            <View style={s.row}>
              <View>
                <Text style={s.label}>Owed to you</Text>
                <Text style={s.h2}>{rands(me.data?.owedEarningsCents ?? 0)}</Text>
              </View>
              <Text style={{ color: C.muted }}>Earnings & fuel →</Text>
            </View>
          </Card>
        </Pressable>
      </Link>

      <Button
        label="Sign out"
        variant="secondary"
        onPress={() =>
          Alert.alert("Sign out?", "You will need your token to sign in again.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign out",
              style: "destructive",
              onPress: async () => {
                await stopTracking();
                await setToken(null);
                router.replace("/sign-in");
              },
            },
          ])
        }
      />

      <Modal
        visible={ending}
        transparent
        animationType="slide"
        onRequestClose={() => setEnding(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
          <View
            style={{
              backgroundColor: C.white,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              gap: 12,
            }}
          >
            <Text style={s.h2}>End shift</Text>
            <Text style={s.body}>Enter your closing odometer reading.</Text>
            <TextInput
              value={odometer}
              onChangeText={setOdometer}
              placeholder="Odometer (km)"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              style={s.input}
              autoFocus
            />
            <Button
              label="End shift"
              variant="danger"
              onPress={() => endShift.mutate()}
              busy={endShift.isPending}
              disabled={!odometer}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setEnding(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function StopCard({
  stop,
  disabled,
  onCollect,
  busy,
}: {
  stop: DriverStop;
  disabled: boolean;
  onCollect: () => void;
  busy: boolean;
}) {
  const isCollection = stop.kind === "collection";
  const tone = stop.status === "delivered" ? "good" : stop.status === "failed" ? "bad" : "neutral";
  return (
    <Card>
      <View style={s.row}>
        <Badge
          label={
            isCollection
              ? `Collect · ${stop.shipments.length} parcel${stop.shipments.length === 1 ? "" : "s"}`
              : "Deliver"
          }
          tone={isCollection ? "warn" : tone}
        />
        <Text style={[s.mono, { fontSize: 12 }]}>{stop.waybill ?? stop.bookingReference}</Text>
      </View>
      <Text style={[s.h2, { marginTop: 8 }]}>
        {stop.address.suburb ?? stop.address.city ?? "Stop"}
      </Text>
      <Text style={[s.body, { marginTop: 2 }]}>{stop.address.formatted}</Text>
      {stop.contact && (
        <Text style={[s.body, { marginTop: 6, color: C.muted }]}>
          {stop.contact.name} · {stop.contact.phone}
        </Text>
      )}
      {stop.instructions && (
        <Text style={[s.body, { marginTop: 6, fontStyle: "italic" }]}>{stop.instructions}</Text>
      )}
      <View style={{ marginTop: 14 }}>
        {isCollection ? (
          <Button
            label="Collected everything"
            onPress={onCollect}
            busy={busy}
            disabled={disabled}
          />
        ) : stop.status === "collected" || stop.status === "in_transit" ? (
          <Link href={{ pathname: "/stop/[id]", params: { id: stop.shipmentId! } }} asChild>
            <Pressable>
              <View
                style={[
                  {
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: C.ink,
                    backgroundColor: C.ink,
                    paddingVertical: 15,
                    alignItems: "center",
                  },
                  disabled && { opacity: 0.45 },
                ]}
              >
                <Text style={{ color: C.white, fontWeight: "600", fontSize: 15 }}>
                  Deliver this drop
                </Text>
              </View>
            </Pressable>
          </Link>
        ) : (
          <Text style={{ color: C.muted }}>
            {stop.status === "assigned"
              ? "Collect from the pickup first."
              : `Status: ${stop.status}`}
          </Text>
        )}
      </View>
    </Card>
  );
}
