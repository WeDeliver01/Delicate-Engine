import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { isSignedIn } from "../src/lib/auth";
import { flush, startFlushing } from "../src/lib/outbox";
import {
  dataOf,
  lastNotificationOpened,
  onNotificationOpened,
  onNotificationReceived,
  registerForPush,
} from "../src/lib/push";
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
  const pushRegistered = useRef(false);

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

  /*
    Three things keep the day current once the driver is in.

    The phone is registered for push, once per launch, so a new job wakes it. Anything queued
    while there was no signal is retried on a timer and whenever the app comes to the front —
    the moment a driver walks back out of a basement is the moment it is worth trying again.
    And coming to the front also re-reads the day, because the list they were looking at an
    hour ago in the van is not the list dispatch has now.
  */
  useEffect(() => {
    if (!ready || !signedIn) return;
    if (!pushRegistered.current) {
      pushRegistered.current = true;
      void registerForPush();
    }
    const stopFlushing = startFlushing();
    const refresh = () => {
      void flush().then((landed) => {
        if (landed > 0) void client.invalidateQueries();
      });
      void client.invalidateQueries({ queryKey: ["day"] });
    };
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    // A push arriving while the app is open: re-read rather than make the driver pull down.
    const received = onNotificationReceived(() => void client.invalidateQueries());
    // A push tapped from the lock screen: open what it was about.
    const open = (shipmentId: string | undefined) => {
      void client.invalidateQueries();
      if (shipmentId) router.push({ pathname: "/stop/[id]", params: { id: shipmentId } });
      else router.push("/");
    };
    const opened = onNotificationOpened((r) => open(dataOf(r).shipmentId));
    void lastNotificationOpened().then((r) => {
      if (r) open(dataOf(r).shipmentId);
    });
    return () => {
      stopFlushing();
      appState.remove();
      received.remove();
      opened.remove();
    };
  }, [ready, signedIn, router]);

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
          <Stack.Screen name="stop/[id]" options={{ title: "Drop" }} />
          <Stack.Screen name="pickup/[id]" options={{ title: "Collection" }} />
          <Stack.Screen name="fuel" options={{ title: "Log fuel" }} />
          <Stack.Screen name="earnings" options={{ title: "Earnings" }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
