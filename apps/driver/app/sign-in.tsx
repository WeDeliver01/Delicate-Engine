import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, API_URL, ApiRequestError } from "../src/lib/api";
import { canSignInWithPassword, setToken, signIn, signOut } from "../src/lib/auth";
import { Button, C, ErrorNote, s } from "../src/lib/ui";

/**
 * Sign in with the email and password the office set up.
 *
 * The same identity the console uses: the engine links the signed-in user to a driver row by
 * email on first contact, so nothing has to be issued by hand. A dev-token box is still here
 * in development builds, because the engine mints those for local work and a production build
 * refuses them anyway.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setTokenText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const withPassword = canSignInWithPassword();

  /** Prove the credentials reach a linked, active driver before leaving this screen. */
  async function enter(getIn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await getIn();
      await api("/v1/driver/me");
      router.replace("/");
    } catch (err) {
      // Signed in to Supabase but not a driver here: do not leave a session behind that makes
      // every screen fail in a way nobody can explain.
      await signOut();
      setError(
        err instanceof ApiRequestError
          ? err.status === 403
            ? "That account is not set up as a driver. Ask the office to add you."
            : err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
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

          {withPassword ? (
            <>
              <Text style={s.body}>Driver app. Sign in with your work email.</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@delicatecourier.co.za"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                inputMode="email"
                keyboardType="email-address"
                textContentType="username"
                style={s.input}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry
                onSubmitEditing={() => void enter(() => signIn(email, password))}
                returnKeyType="go"
                style={s.input}
              />
              {error && <ErrorNote message={error} />}
              <Button
                label="Sign in"
                onPress={() => void enter(() => signIn(email, password))}
                busy={busy}
                disabled={email.trim().length < 3 || password.length === 0}
              />
            </>
          ) : (
            <>
              <Text style={s.body}>Sign in with the token your dispatcher gave you.</Text>
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
                onPress={() => void enter(() => setToken(token.trim()))}
                busy={busy}
                disabled={token.trim().length < 20}
              />
              <Text style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
                This build has no email sign-in configured.
              </Text>
            </>
          )}

          {withPassword && __DEV__ && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={[s.label, { textAlign: "center" }]}>or, in development</Text>
              <TextInput
                value={token}
                onChangeText={setTokenText}
                placeholder="Paste a dev token"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                style={[s.input, { minHeight: 70, textAlignVertical: "top", fontSize: 12 }]}
              />
              <Button
                label="Use token"
                variant="secondary"
                onPress={() => void enter(() => setToken(token.trim()))}
                busy={busy}
                disabled={token.trim().length < 20}
              />
            </View>
          )}

          <Text style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
            Engine: {API_URL}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
