import { useEffect, useState } from "react";
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
import type { DriverDay, DriverStop, Shift, StopTally } from "@delicate/contracts";
import { SHIPMENT_STATUS_LABELS } from "@delicate/contracts";
import { api, ApiRequestError } from "../src/lib/api";
import { signOut } from "../src/lib/auth";
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

type Tab = "all" | "collections" | "deliveries";

const TABS: { key: Tab; label: string; of: (p: DriverDay["progress"]) => StopTally }[] = [
  { key: "all", label: "All", of: (p) => p.all },
  { key: "collections", label: "Collect", of: (p) => p.collections },
  { key: "deliveries", label: "Deliver", of: (p) => p.deliveries },
];

/**
 * The driver's day.
 *
 * There is nothing to start. Dispatch rosters the driver and assigns the work; it appears here
 * and they get on with it. The screen's only job is to answer three questions without being
 * asked: what is next, how much is left, and am I finished.
 */
export default function Today() {
  const qc = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [odometer, setOdometer] = useState("");
  const [logging, setLogging] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/driver/me") });
  const day = useQuery({
    queryKey: ["day"],
    queryFn: () => api<DriverDay>("/v1/driver/day"),
    refetchInterval: 60_000,
  });

  // Tracking follows having work, not having pressed anything — there is no longer a Start to
  // hang it on. Keyed on whether anything is outstanding, so the trail runs while there are
  // stops left and stops when the day is cleared, and the permission prompt arrives when the
  // driver can see the work it is being asked for.
  const outstanding = day.data?.progress.all.outstanding ?? 0;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (outstanding > 0) {
        const perms = await requestPermissions();
        if (!cancelled && perms.background) await startTracking();
      } else if (day.isSuccess) {
        await stopTracking();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outstanding, day.isSuccess]);
  const invalidate = () => qc.invalidateQueries();
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const logOdometer = useMutation({
    mutationFn: async () =>
      api<Shift | null>("/v1/driver/odometer", {
        method: "POST",
        json: { odometerKm: Number(odometer), location: await currentPosition() },
      }),
    onSuccess: (shift) => {
      setOdometer("");
      setLogging(false);
      setError(
        shift
          ? null
          : "Saved nothing: you are not on today's roster, so there was no day to record it against.",
      );
      invalidate();
    },
    onError,
  });

  if (me.isLoading || day.isLoading) return <Loading />;
  if (me.error) return <ErrorNote message={(me.error as Error).message} />;

  const progress = day.data?.progress;
  const stops = day.data?.stops ?? [];
  const shown =
    tab === "all"
      ? stops
      : stops.filter((x) => (tab === "collections") === (x.kind === "collection"));

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
          {progress && progress.all.total > 0 && (
            <Badge
              label={progress.allDone ? "All done" : `${progress.all.outstanding} to go`}
              tone={progress.allDone ? "good" : "neutral"}
            />
          )}
        </View>
        <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}>
          <Button
            label="Log fuel"
            variant="secondary"
            onPress={() => router.push("/fuel")}
            style={{ flex: 1 }}
          />
          <Button
            label="Odometer"
            variant="secondary"
            onPress={() => setLogging(true)}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      {error && <ErrorNote message={error} />}

      {progress?.allDone && (
        <Card style={{ backgroundColor: C.greenSoft, borderColor: C.green }}>
          <Text style={[s.h2, { color: C.green }]}>All done for today</Text>
          <Text style={[s.body, { marginTop: 6 }]}>
            {progress.deliveries.done} delivered, {progress.collections.done} collected. If dispatch
            adds anything else it will appear here — the list refreshes on its own.
          </Text>
        </Card>
      )}

      {stops.length === 0 ? (
        <Card>
          <Text style={s.h2}>Nothing assigned yet</Text>
          <Text style={[s.body, { marginTop: 6 }]}>
            Dispatch will send work as bookings come in. Pull down to refresh.
          </Text>
        </Card>
      ) : (
        <>
          <Tabs progress={progress!} active={tab} onChange={setTab} />
          {day.data?.route && day.data.route.savedKm > 0 && !progress?.allDone && (
            <Card>
              <Text style={s.body}>
                {progress!.all.outstanding} left · about {day.data.route.totalKm} km, ordered to
                save {day.data.route.savedKm} km on the run.
              </Text>
            </Card>
          )}
          {shown.length === 0 ? (
            <Card>
              <Text style={s.body}>
                Nothing in this list. Try <Text style={{ fontWeight: "700" }}>All</Text> to see the
                rest of the day.
              </Text>
            </Card>
          ) : (
            shown.map((stop, i) => (
              <StopCard
                key={`${stop.kind}-${stop.shipmentId ?? stop.bookingId}-${i}`}
                stop={stop}
              />
            ))
          )}
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
          Alert.alert("Sign out?", "You will need your email and password to sign in again.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign out",
              style: "destructive",
              onPress: async () => {
                await stopTracking();
                await signOut();
                router.replace("/sign-in");
              },
            },
          ])
        }
      />

      <Modal
        visible={logging}
        transparent
        animationType="slide"
        onRequestClose={() => setLogging(false)}
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
            <Text style={s.h2}>Odometer reading</Text>
            <Text style={s.body}>
              Optional, and useful whenever you remember — at the depot in the morning or back at
              the end. The first reading of the day opens it and the last one closes it.
            </Text>
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
              label="Save reading"
              onPress={() => logOdometer.mutate()}
              busy={logOdometer.isPending}
              disabled={!odometer}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setLogging(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/**
 * Collect / Deliver / All, each carrying what is left in it.
 *
 * The count is the outstanding one, not the total: a driver glancing at this wants to know
 * what is still on them. A tab with nothing left is ticked rather than shown as zero, because
 * "0" reads at a glance like "nothing here" when it means "all of it is finished".
 */
function Tabs({
  progress,
  active,
  onChange,
}: {
  progress: DriverDay["progress"];
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {TABS.map(({ key, label, of }) => {
        const tally = of(progress);
        const on = key === active;
        return (
          <Pressable key={key} onPress={() => onChange(key)} style={{ flex: 1 }}>
            <View
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? C.ink : C.line,
                backgroundColor: on ? C.ink : C.white,
                paddingVertical: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: on ? C.white : C.body, fontWeight: "600", fontSize: 14 }}>
                {label}
                {tally.total === 0 ? "" : tally.outstanding === 0 ? " ✓" : ` ${tally.outstanding}`}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function StopCard({ stop }: { stop: DriverStop }) {
  const isCollection = stop.kind === "collection";
  const tone = stop.status === "delivered" ? "good" : stop.status === "failed" ? "bad" : "neutral";
  // One tap opens the stop, whichever kind it is. The actions that used to be on this card
  // — collect, navigate, ring the contact — are all on the stop itself now, which is where a
  // driver standing at the gate is already looking.
  const href = isCollection
    ? ({ pathname: "/pickup/[id]", params: { id: stop.bookingId } } as const)
    : ({ pathname: "/stop/[id]", params: { id: stop.shipmentId! } } as const);
  return (
    <Card style={stop.done ? { opacity: 0.6 } : undefined}>
      <View style={s.row}>
        <Badge
          label={
            isCollection
              ? `Collect · ${stop.shipments.length} parcel${stop.shipments.length === 1 ? "" : "s"}`
              : stop.status
                ? SHIPMENT_STATUS_LABELS[stop.status]
                : "Deliver"
          }
          tone={isCollection ? (stop.done ? "good" : "warn") : tone}
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
        {stop.done ? (
          <Text style={{ color: C.muted }}>
            {isCollection
              ? "Collected."
              : stop.status === "failed"
                ? "Attempted — dispatch will reassign it."
                : "Delivered."}
          </Text>
        ) : (
          <Link href={href} asChild>
            <Pressable>
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: C.ink,
                  backgroundColor: C.ink,
                  paddingVertical: 15,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: C.white, fontWeight: "600", fontSize: 15 }}>
                  {isCollection ? "Open this collection" : "Open this drop"}
                </Text>
              </View>
            </Pressable>
          </Link>
        )}
      </View>
    </Card>
  );
}
