import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, API_URL, ApiRequestError } from "../src/lib/api";
import { setToken } from "../src/lib/auth";
import { Button, C, ErrorNote, s } from "../src/lib/ui";

/**
 * Phase 2 sign-in: paste the token the engine mints (`dev:token <driver>`); Supabase email
 * sign-in replaces this form in Phase 5 without changing anything downstream.
 */
export default function SignIn() {
  const router = useRouter();
  const [token, setTokenText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await setToken(token.trim());
      await api("/v1/driver/me"); // proves the token is a linked, active driver
      router.replace("/");
    } catch (err) {
      await setToken(null);
      setError(err instanceof ApiRequestError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: "center" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Text style={s.h1}>Delicate</Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.pink }} />
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.purple }} />
          </View>
          <Text style={s.body}>Driver app. Sign in with the token your dispatcher gave you.</Text>
          <TextInput
            value={token}
            onChangeText={setTokenText}
            placeholder="Paste your token"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[s.input, { minHeight: 110, textAlignVertical: "top", fontSize: 12 }]}
          />
          {error && <ErrorNote message={error} />}
          <Button
            label="Sign in"
            onPress={submit}
            busy={busy}
            disabled={token.trim().length < 20}
          />
          <Text style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
            Engine: {API_URL}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
