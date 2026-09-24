import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

/** Brand tokens shared with the web app so the two products feel like one. */
export const C = {
  ink: "#0A0A0A",
  pink: "#E84A8A",
  pinkSoft: "#FCEEF4",
  purple: "#7C5CFF",
  yellow: "#F4C430",
  green: "#1B7F4B",
  greenSoft: "#E6F4EC",
  surface: "#F8F6F3",
  line: "#ECEAE6",
  muted: "#86817A",
  body: "#3A3631",
  white: "#FFFFFF",
  danger: "#C13B73",
};

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const v = props.variant ?? "primary";
  const bg = v === "primary" ? C.ink : v === "danger" ? C.white : C.white;
  const fg = v === "primary" ? C.white : v === "danger" ? C.danger : C.ink;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: bg,
          borderColor: v === "primary" ? C.ink : v === "danger" ? C.danger : C.line,
        },
        (props.disabled || props.busy) && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.98 }] },
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, { color: fg }]}>{props.label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const map = {
    neutral: { bg: C.surface, fg: C.body },
    good: { bg: C.greenSoft, fg: C.green },
    warn: { bg: "#FBF1D6", fg: "#8A5A06" },
    bad: { bg: C.pinkSoft, fg: C.danger },
  }[tone];
  return (
    <View style={[s.badge, { backgroundColor: map.bg }]}>
      <Text style={[s.badgeText, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={C.pink} />
      <Text style={{ color: C.muted, marginTop: 8 }}>{label}</Text>
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={s.error}>
      <Text style={{ color: C.danger }}>{message}</Text>
    </View>
  );
}

export function rands(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}R${Math.floor(abs / 100).toLocaleString("en-ZA")},${String(abs % 100).padStart(2, "0")}`;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surface },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: C.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
  },
  h1: { fontSize: 26, fontWeight: "800", color: C.ink, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: "700", color: C.ink },
  label: { fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: 0.6 },
  body: { fontSize: 15, color: C.body },
  mono: { fontFamily: "monospace", color: C.ink },
  btn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "600" },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { backgroundColor: C.pinkSoft, borderRadius: 12, padding: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#DAD6CF",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: C.white,
    color: C.ink,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
});
