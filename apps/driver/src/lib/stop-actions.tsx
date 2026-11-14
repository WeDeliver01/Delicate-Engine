import { useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { DriverNotifyResult, DriverStop, EtaChoice } from "@delicate/contracts";
import { api, ApiRequestError } from "./api";
import { mailtoUrl, navigationUrl, mapsWebUrl, smsUrl, telUrl } from "./handoff";
import { currentPosition } from "./location";
import { submit } from "./outbox";
import { attemptId } from "./queue";
import { Button, C, Card, s } from "./ui";

/**
 * "I'm here."
 *
 * Arrival is its own fact, separate from collecting or delivering: it is what the dispatcher's
 * ETA is measured against, and on a drop it is what tells the recipient the van is outside.
 * Only offered when the stop sits on a trip the engine knows about, which — now that every
 * assignment lands on one — is nearly always.
 */
export function ArriveButton({ stop }: { stop: DriverStop }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!stop.tripStopId || stop.done) return null;
  if (stop.tripStopStatus === "arrived") {
    return (
      <Card>
        <Text style={s.body}>You are marked as here. Dispatch and the recipient can see it.</Text>
      </Card>
    );
  }
  if (stop.tripStopStatus !== "pending") return null;

  async function arrive() {
    setBusy(true);
    try {
      await submit({
        id: attemptId(Date.now()),
        kind: "arrive",
        shipmentId: stop.shipmentId,
        bookingId: stop.bookingId,
        path: "/v1/driver/trip/arrive",
        body: { stopId: stop.tripStopId, location: await currentPosition() },
        label: `Arrived at ${stop.address.suburb ?? stop.address.formatted}`,
      });
      await qc.invalidateQueries({ queryKey: ["day"] });
    } catch (err) {
      Alert.alert(
        "Not recorded",
        err instanceof ApiRequestError ? err.message : "Could not reach the engine.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      label={stop.kind === "drop" ? "I've arrived — tell the recipient" : "I've arrived"}
      variant="secondary"
      onPress={() => void arrive()}
      busy={busy}
    />
  );
}

/** Open navigation, falling back to the browser where no maps app answers the scheme. */
export async function navigateTo(stop: DriverStop): Promise<void> {
  const location = stop.address.location;
  if (!location) {
    Alert.alert(
      "No map for this address",
      "It was never placed on the map, so navigation would be a guess. The address is on the card — tell the office so it can be fixed.",
    );
    return;
  }
  const place = { ...location, label: stop.address.formatted };
  const app = navigationUrl(place, Platform.OS);
  try {
    if (await Linking.canOpenURL(app)) {
      await Linking.openURL(app);
      return;
    }
  } catch {
    // Fall through: a scheme check that throws is the same as one that says no.
  }
  await Linking.openURL(mapsWebUrl(place));
}

/**
 * Navigate, call, and tell someone where you are.
 *
 * The three things a driver does at a stop that are not the delivery itself. Grouped because
 * they are used at a collection and at a drop alike, and because a driver holding a phone in
 * one hand wants them in the same place both times.
 */
export function StopActions({
  stop,
  target,
}: {
  stop: DriverStop;
  /** The collection contact at a pickup, the recipient at a drop. */
  target: "collection" | "recipient";
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const phone = stop.contact?.phone ?? null;
  /** The number that saves the stop when the first one rings out. */
  const altPhone = stop.contact?.altPhone ?? null;

  /**
   * Ask the engine to send it, and send it ourselves if the engine cannot.
   *
   * The engine answers with who is delivering the message. `driver` means no SMS provider is
   * configured, so the phone's own composer opens pre-filled — the driver still has to press
   * send, which is honest: the app never claims a message went out that did not.
   */
  async function notify(eta: EtaChoice, channel: "sms" | "email") {
    if (!stop.shipmentId) return;
    setBusy(`${channel}:${eta}`);
    try {
      const res = await api<DriverNotifyResult>("/v1/driver/notify", {
        method: "POST",
        json: { shipmentId: stop.shipmentId, target, channel, eta },
      });
      if (res.delivery === "engine") {
        Alert.alert("Sent", `We have sent that by ${res.channel}.`);
        return;
      }
      if (res.delivery === "driver" && res.to) {
        const url =
          res.channel === "sms"
            ? smsUrl(res.to, res.text, Platform.OS)
            : mailtoUrl(res.to, "Your delivery", res.text);
        await Linking.openURL(url);
        return;
      }
      Alert.alert("Not sent", res.reason ?? "This message could not be sent.");
    } catch (err) {
      Alert.alert(
        "Not sent",
        err instanceof ApiRequestError ? err.message : "Could not reach the engine.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <Text style={s.label}>At this stop</Text>
      <View style={{ marginTop: 10, flexDirection: "row", gap: 10 }}>
        <Button label="Navigate" onPress={() => void navigateTo(stop)} style={{ flex: 1 }} />
        <Button
          label="Call"
          variant="secondary"
          disabled={!phone}
          onPress={() => phone && void Linking.openURL(telUrl(phone))}
          style={{ flex: 1 }}
        />
      </View>
      {altPhone && (
        <View style={{ marginTop: 10 }}>
          <Button
            label="Call the other number"
            variant="secondary"
            onPress={() => void Linking.openURL(telUrl(altPhone))}
          />
        </View>
      )}

      {stop.shipmentId && (
        <>
          <Text style={[s.label, { marginTop: 16 }]}>
            {target === "recipient" ? "Tell the recipient" : "Tell the sender"}
          </Text>
          <Text style={[s.body, { marginTop: 4, color: C.muted }]}>
            Sent as a text where we can, otherwise your own messaging app opens with the words
            ready.
          </Text>
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {([5, 10, 30, "arrived"] as EtaChoice[]).map((eta) => (
              <Pressable
                key={String(eta)}
                onPress={() => void notify(eta, "sms")}
                disabled={busy !== null}
                style={{ flexGrow: 1 }}
              >
                <View
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: C.ink,
                    paddingVertical: 11,
                    paddingHorizontal: 14,
                    alignItems: "center",
                    opacity: busy !== null && busy !== `sms:${eta}` ? 0.45 : 1,
                  }}
                >
                  <Text style={{ color: C.ink, fontWeight: "600", fontSize: 14 }}>
                    {eta === "arrived" ? "I'm here" : `${eta} min`}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <Button
            label="Email them instead"
            variant="secondary"
            onPress={() => void notify("arrived", "email")}
            busy={busy?.startsWith("email") ?? false}
            style={{ marginTop: 10 }}
          />
        </>
      )}
    </Card>
  );
}
