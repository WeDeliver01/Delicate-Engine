import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  DRIVER_SETTABLE_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TRANSITIONS,
  type DriverStop,
  type ShipmentStatus,
} from "@delicate/contracts";
import { ApiRequestError } from "./api";
import { currentPosition } from "./location";
import { submit } from "./outbox";
import { attemptId } from "./queue";
import { Button, C, Card, s } from "./ui";

/**
 * Move the shipment along.
 *
 * Only the statuses it can actually reach from where it is, worked out from the same
 * transition table the engine checks against — so a driver is never offered a button that
 * will be refused. `delivered` is not here: it goes through the delivery screen, which takes a
 * name and a photograph.
 */
export function StatusControl({ stop }: { stop: DriverStop }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const [note, setNote] = useState("");

  const current = stop.status;
  const reachable = current
    ? DRIVER_SETTABLE_STATUSES.filter(
        (to) => to !== current && SHIPMENT_TRANSITIONS[current].includes(to),
      )
    : [];
  if (!stop.shipmentId || reachable.length === 0) return null;

  async function set(status: ShipmentStatus, withNote?: string) {
    setBusy(true);
    try {
      // Through the outbox: a status set where there is no signal is kept and sent later, and
      // the engine answers a repeat of a status it already has with the same shipment.
      const res = await submit({
        id: attemptId(Date.now()),
        kind: "status",
        shipmentId: stop.shipmentId,
        bookingId: stop.bookingId,
        path: "/v1/driver/status",
        body: {
          shipmentId: stop.shipmentId,
          status,
          note: withNote?.trim() || null,
          location: await currentPosition(),
        },
        label: `${SHIPMENT_STATUS_LABELS[status]} · ${stop.waybill ?? ""}`.trim(),
      });
      setHolding(false);
      setNote("");
      await qc.invalidateQueries();
      if (!res.landed) {
        Alert.alert(
          "Saved on your phone",
          "No signal here. The status is recorded and will be sent when you are back in range.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Not changed",
        err instanceof ApiRequestError ? err.message : "Could not reach the engine.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={s.row}>
        <Text style={s.label}>Status</Text>
        <Text style={{ color: C.ink, fontWeight: "700", fontSize: 14 }}>
          {current ? SHIPMENT_STATUS_LABELS[current] : "—"}
        </Text>
      </View>

      {holding ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          <Text style={s.body}>
            What is holding it up? The sender is told, so write what they would need to know.
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="No answer at the gate"
            placeholderTextColor={C.muted}
            style={s.input}
            autoFocus
          />
          <Button
            label="Put on hold"
            onPress={() => void set("on_hold", note)}
            busy={busy}
            disabled={!note.trim()}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setHolding(false)} />
        </View>
      ) : (
        <View style={{ marginTop: 12, gap: 8 }}>
          {reachable.map((to) => (
            <Pressable
              key={to}
              onPress={() => (to === "on_hold" ? setHolding(true) : void set(to))}
              disabled={busy}
            >
              <View
                style={{
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: to === "on_hold" ? C.line : C.ink,
                  backgroundColor: to === "on_hold" ? C.white : C.ink,
                  paddingVertical: 13,
                  alignItems: "center",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: to === "on_hold" ? C.body : C.white,
                    fontWeight: "600",
                    fontSize: 15,
                  }}
                >
                  {to === "out_for_delivery"
                    ? "Out for delivery — start tracking"
                    : SHIPMENT_STATUS_LABELS[to]}
                </Text>
              </View>
            </Pressable>
          ))}
          <Text style={[s.body, { color: C.muted, fontSize: 13 }]}>
            Marking it out for delivery lets the recipient watch you on the map and tells them you
            are on the way.
          </Text>
        </View>
      )}
    </Card>
  );
}
