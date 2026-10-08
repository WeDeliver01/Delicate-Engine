import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isSignedIn } from "../src/lib/auth";
import { C, Loading } from "../src/lib/ui";
import "../src/lib/location";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true } },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    isSignedIn().then((yes) => {
      setSignedIn(yes);
      setReady(true);
    });
  }, [segments]);

  useEffect(() => {
    if (!ready) return;
    const onSignIn = segments[0] === "sign-in";
    if (!signedIn && !onSignIn) router.replace("/sign-in");
    if (signedIn && onSignIn) router.replace("/");
  }, [ready, signedIn, segments, router]);

  if (!ready) return <Loading label="Starting…" />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.white },
            headerTintColor: C.ink,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: C.surface },
          }}
        >
          <Stack.Screen name="index" options={{ title: "Today" }} />
          <Stack.Screen name="sign-in" options={{ title: "Sign in", headerShown: false }} />
          <Stack.Screen name="stop/[id]" options={{ title: "Stop" }} />
          <Stack.Screen name="fuel" options={{ title: "Log fuel" }} />
          <Stack.Screen name="earnings" options={{ title: "Earnings" }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
