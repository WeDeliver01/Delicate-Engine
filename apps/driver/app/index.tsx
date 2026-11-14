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
import { currentPosition, syncTracking, type Permissions } from "../src/lib/location";
import { discard, flush, retry, useOutbox } from "../src/lib/outbox";
import { unregisterPush } from "../src/lib/push";
import { pendingFor, type Queue } from "../src/lib/queue";
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

/** How often the list re-reads itself. A push arrives sooner; this is the floor. */
const REFRESH_MS = 20_000;

/**
 * The driver's day.
 *
 * Work appears here the moment dispatch (or the engine) assigns it: the list re-reads itself
 * every twenty seconds, when the app comes to the front, and when a push arrives. The driver
 * goes online with one button, which also shares their position with dispatch and, once a
 * parcel is out for delivery, with the person waiting for it.
 *
 * The screen answers three questions without being asked: what is next, how much is left,
 * and am I finished. Later days are shown under their own heading so they are never mistaken
 * for the next place to drive to.
 */
export default function Today() {
  const qc = useQueryClient();
  const router = useRouter();
  const outbox = useOutbox();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [odometer, setOdometer] = useState("");
  const [logging, setLogging] = useState(false);
  const [perms, setPerms] = useState<Permissions | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/driver/me") });
  const day = useQuery({
    queryKey: ["day"],
    queryFn: () => api<DriverDay>("/v1/driver/day"),
    refetchInterval: REFRESH_MS,
  });

  const shift = day.data?.shift ?? null;
  const online = shift?.status === "open";
  const outstanding = day.data?.progress.all.outstanding ?? 0;

  /*
    Tracking follows the work, not only the button.

    On shift, or holding stops that are not done, the van's position is shared. A driver who
    never pressed "Go online" but is standing at a collection with three parcels assigned to
    them is working, and the recipient of the parcel they mark out for delivery is promised a
    live map — a map that was blank whenever the roster, not the work, decided whether the
    phone reported in. Off shift with nothing outstanding, tracking stops: their time is theirs.
  */
  const working = online || outstanding > 0;
  useEffect(() => {
    if (!day.isSuccess) return;
    let cancelled = false;
    void syncTracking(working).then((p) => {
      if (!cancelled) setPerms(p);
    });
    return () => {
      cancelled = true;
    };
  }, [working, day.isSuccess]);

  const invalidate = () => qc.invalidateQueries();
  const onError = (e: unknown) => setError(e instanceof ApiRequestError ? e.message : String(e));

  const clock = useMutation({
    mutationFn: async (to: "start" | "end") =>
      api<Shift | null>(`/v1/driver/shift/${to}`, {
        method: "POST",
        // Sent if the phone will give one, so the day's trail starts where the driver did. A
        // refusal is not an obstacle: the press has to work with location switched off.
        json: { location: await currentPosition().catch(() => null) },
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError,
  });

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
        shift ? null : "Saved nothing: go online first, so there is a day to record it against.",
      );
      invalidate();
    },
    onError,
  });

  if (me.isLoading || day.isLoading) return <Loading />;
  if (me.error) return <ErrorNote message={(me.error as Error).message} />;

  const progress = day.data?.progress;
  const stops = day.data?.stops ?? [];
  const upcoming = day.data?.upcoming ?? [];
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
          onRefresh={() => {
            void flush();
            void day.refetch();
          }}
          tintColor={C.pink}
        />
      }
    >
      <Card>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>{day.data?.date}</Text>
            <Text style={s.h2}>{me.data?.driver.fullName}</Text>
            {day.data?.trip && (
              <Text style={[s.mono, { fontSize: 12, marginTop: 2, color: C.muted }]}>
                {day.data.trip.reference}
              </Text>
            )}
          </View>
          {progress && progress.all.total > 0 && (
            <Badge
              label={progress.allDone ? "All done" : `${progress.all.outstanding} to go`}
              tone={progress.allDone ? "good" : "neutral"}
            />
          )}
        </View>

        {/* One button, and nothing to fill in to press it. */}
        <Button
          label={online ? "Go offline" : shift?.startedAt ? "Go online again" : "Go online"}
          variant={online ? "secondary" : "primary"}
          onPress={() => clock.mutate(online ? "end" : "start")}
          busy={clock.isPending}
          style={{ marginTop: 14 }}
        />
        <Text style={[s.label, { marginTop: 8 }]}>
          {online
            ? `Online${shift?.startedAt ? ` since ${clockTime(shift.startedAt)}` : ""} · dispatch can see where you are`
            : working
              ? "You have work on your list, so your position is shared while you have stops to do. Go online when you set off."
              : "Offline. Your position is only shared while you are online or have stops to do."}
        </Text>
        {perms && !perms.foreground && working && (
          <ErrorNote message="Location is switched off for this app, so dispatch and your recipients cannot see you coming. Allow it in your phone's settings." />
        )}
        {perms && perms.foreground && !perms.background && working && (
          <Text style={[s.body, { marginTop: 8, color: C.muted, fontSize: 13 }]}>
            Your position is shared while the app is open. Allow location “all the time” in your
            phone's settings and it will keep sharing with the app in your pocket.
          </Text>
        )}

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

      <OutboxBanner queue={outbox} />

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
          <Text style={s.h2}>Nothing for today yet</Text>
          <Text style={[s.body, { marginTop: 6 }]}>
            Dispatch will send work as bookings come in — your phone will buzz, and the list
            refreshes on its own. Pull down to check now.
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
                queue={outbox}
              />
            ))
          )}
        </>
      )}

      {upcoming.length > 0 && <Upcoming stops={upcoming} today={day.data?.date ?? ""} />}

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
          Alert.alert(
            "Sign out?",
            outbox.length > 0
              ? `${outbox.length} action${outbox.length === 1 ? " is" : "s are"} still waiting for signal and will be lost. Wait until they have sent.`
              : "You will need your email and password to sign in again.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign out",
                style: "destructive",
                onPress: async () => {
                  await syncTracking(false);
                  await unregisterPush();
                  await signOut();
                  router.replace("/sign-in");
                },
              },
            ],
          )
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
              Optional. Log one whenever you remember, at the depot in the morning or back at the
              end, or not at all. The first reading of the day is kept as the opening one and the
              last as the closing one.
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
 * What is still on the phone, waiting to be sent.
 *
 * Quiet while things are merely waiting for signal — that is normal and the list says
 * "Sending…" on the stop. Loud when the engine has refused one, because that needs a person:
 * the parcel was handed over whatever the engine said, and the driver decides whether to try
 * again or let dispatch sort it out.
 */
function OutboxBanner({ queue }: { queue: Queue }) {
  if (queue.length === 0) return null;
  const stuck = queue.filter((a) => a.stuck);
  const waiting = queue.length - stuck.length;
  return (
    <Card style={stuck.length ? { borderColor: C.danger } : undefined}>
      {waiting > 0 && (
        <Text style={s.body}>
          {waiting} update{waiting === 1 ? "" : "s"} waiting for signal. They send on their own the
          moment you are back in range.
        </Text>
      )}
      {stuck.map((a) => (
        <View key={a.id} style={{ marginTop: waiting > 0 ? 12 : 0, gap: 8 }}>
          <Text style={[s.h2, { color: C.danger, fontSize: 15 }]}>Could not send: {a.label}</Text>
          <Text style={[s.body, { color: C.muted, fontSize: 13 }]}>{a.lastError}</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => retry(a.id)}
              style={{ flex: 1 }}
            />
            <Button
              label="Discard"
              variant="danger"
              onPress={() =>
                Alert.alert(
                  "Discard this update?",
                  "The engine will not hear about it. Tell dispatch what happened so they can record it.",
                  [
                    { text: "Keep", style: "cancel" },
                    { text: "Discard", style: "destructive", onPress: () => discard(a.id) },
                  ],
                )
              }
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ))}
    </Card>
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

/**
 * Later days, under their own heading.
 *
 * Grouped by date so Friday's three stops read as Friday's, and shown as plain cards without a
 * big button: there is nothing to drive to yet. Opening one still works, for a driver who wants
 * to see the address or ring ahead.
 */
function Upcoming({ stops, today }: { stops: DriverStop[]; today: string }) {
  const byDate = new Map<string, DriverStop[]>();
  for (const stop of stops) {
    const key = stop.slotDate ?? today;
    byDate.set(key, [...(byDate.get(key) ?? []), stop]);
  }
  return (
    <>
      <View style={{ marginTop: 8 }}>
        <Text style={s.label}>Coming up</Text>
        <Text style={[s.body, { marginTop: 4, color: C.muted }]}>
          {stops.length} stop{stops.length === 1 ? "" : "s"} on later days. Not part of today's
          count.
        </Text>
      </View>
      {[...byDate.entries()].map(([date, list]) => (
        <View key={date} style={{ gap: 12 }}>
          <Text style={[s.h2, { fontSize: 15 }]}>{dayLabel(date)}</Text>
          {list.map((stop, i) => (
            <StopCard
              key={`${stop.kind}-${stop.shipmentId ?? stop.bookingId}-${i}`}
              stop={stop}
              queue={[]}
              compact
            />
          ))}
        </View>
      ))}
    </>
  );
}

function StopCard({
  stop,
  queue,
  compact = false,
}: {
  stop: DriverStop;
  queue: Queue;
  compact?: boolean;
}) {
  const isCollection = stop.kind === "collection";
  const sending = pendingFor(queue, { shipmentId: stop.shipmentId, bookingId: stop.bookingId });
  const tone = stop.status === "delivered" ? "good" : stop.status === "failed" ? "bad" : "neutral";
  // One tap opens the stop, whichever kind it is. The actions that used to be on this card
  // — collect, navigate, ring the contact — are all on the stop itself now, which is where a
  // driver standing at the gate is already looking.
  const href = isCollection
    ? ({ pathname: "/pickup/[id]", params: { id: stop.bookingId } } as const)
    : ({ pathname: "/stop/[id]", params: { id: stop.shipmentId! } } as const);
  return (
    <Link href={href} asChild>
      <Pressable>
        <Card style={stop.done ? { opacity: 0.6 } : undefined}>
          <View style={s.row}>
            <Badge
              label={
                sending
                  ? "Sending…"
                  : isCollection
                    ? `Collect · ${stop.shipments.length} parcel${stop.shipments.length === 1 ? "" : "s"}`
                    : stop.status
                      ? SHIPMENT_STATUS_LABELS[stop.status]
                      : "Deliver"
              }
              tone={sending ? "neutral" : isCollection ? (stop.done ? "good" : "warn") : tone}
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
          {stop.instructions && !compact && (
            <Text style={[s.body, { marginTop: 6, fontStyle: "italic" }]}>{stop.instructions}</Text>
          )}
          {stop.changed && !stop.done && (
            <Text style={[s.body, { marginTop: 6, color: C.danger, fontWeight: "600" }]}>
              Changed since you were assigned — open it before you set off.
            </Text>
          )}
          {!compact && (
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
              )}
            </View>
          )}
        </Card>
      </Pressable>
    </Link>
  );
}

/** "07:14" in the phone's own locale. A driver wants the time, not the date they already know. */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "Fri 15 Nov" from "2026-11-15", in the phone's locale. */
function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? isoDate
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
