import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Truck, Smartphone, Apple, Download, ArrowLeft, Mail, ExternalLink, Loader2 } from "lucide-react";
import { injectDriverManifest, setMobileViewportHeight, isIOS } from "@/lib/driver-pwa";

interface InstallInfo {
  android: {
    available: boolean;
    downloadUrl: string;
    version?: string;
    sizeBytes?: number;
    updatedAt?: string;
  };
  ios: {
    testflightUrl: string | null;
    requestEmail: string;
  };
}

export default function DriverInstall() {
  const [, setLocation] = useLocation();
  const [info, setInfo] = useState<InstallInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const onIOS = isIOS();

  useEffect(() => {
    injectDriverManifest();
    setMobileViewportHeight();
    fetch("/api/driver/install/info")
      .then((r) => r.json())
      .then((data) => { setInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="driver-fullscreen-min w-full" style={{ background: "linear-gradient(135deg, hsl(var(--v7-surface-inset)) 0%, hsl(var(--v7-surface-base)) 50%, hsl(var(--v7-jacaranda-900)) 100%)" }}>
      <header className="flex items-center gap-3 px-4 py-3" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button onClick={() => setLocation("/driver/login")} className="p-2 -ml-2 text-text-tertiary" data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-jacaranda-500/20 flex items-center justify-center">
            <Truck className="w-4 h-4 text-jacaranda-400" />
          </div>
          <h1 className="text-base font-semibold text-text-primary">Install Delicate Driver</h1>
        </div>
      </header>

      <main className="px-4 pb-12 max-w-md mx-auto space-y-4">
        <div className="text-sm text-text-secondary">
          The native app keeps your location reporting to dispatch even when your screen is locked or the phone reboots — something the browser version cannot do reliably.
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-jacaranda-400 animate-spin" />
          </div>
        ) : (
          <>
            <section
              className="rounded-2xl p-5 space-y-4"
              style={{ background: "hsl(var(--v7-surface-overlay) / 0.6)", border: "1px solid hsl(var(--v7-border-hairline))", backdropFilter: "blur(10px)" }}
              data-testid="section-android"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">Android</h2>
                  <p className="text-xs text-text-tertiary">Direct APK download</p>
                </div>
              </div>

              {info?.android.available ? (
                <>
                  <div className="text-xs text-text-tertiary space-y-1">
                    {info.android.version && <div data-testid="text-android-version">Version {info.android.version}</div>}
                    {info.android.sizeBytes && <div>{formatSize(info.android.sizeBytes)}</div>}
                  </div>
                  <a
                    href={info.android.downloadUrl}
                    className="w-full h-12 rounded-xl bg-emerald-500 text-text-primary font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                    data-testid="link-android-download"
                  >
                    <Download className="w-4 h-4" />
                    Download APK
                  </a>
                  <ol className="text-xs text-text-tertiary space-y-1 list-decimal pl-4">
                    <li>Tap the link above and accept the download.</li>
                    <li>Open the APK and tap Install (you may need to enable "Install unknown apps" for your browser).</li>
                    <li>Open Delicate Driver and grant location "Always" + notification permissions.</li>
                  </ol>
                </>
              ) : (
                <div className="text-xs text-text-tertiary p-3 rounded-lg bg-amber-500/10 border border-amber-500/20" data-testid="text-android-unavailable">
                  The Android APK has not been published yet. Ask dispatch when the next build will be available.
                </div>
              )}
            </section>

            <section
              className="rounded-2xl p-5 space-y-4"
              style={{ background: "hsl(var(--v7-surface-overlay) / 0.6)", border: "1px solid hsl(var(--v7-border-hairline))", backdropFilter: "blur(10px)" }}
              data-testid="section-ios"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <Apple className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">iPhone &amp; iPad</h2>
                  <p className="text-xs text-text-tertiary">TestFlight invitation</p>
                </div>
              </div>

              {info?.ios.testflightUrl ? (
                <a
                  href={info.ios.testflightUrl}
                  className="w-full h-12 rounded-xl bg-blue-500 text-text-primary font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                  data-testid="link-ios-testflight"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open TestFlight Invite
                </a>
              ) : (
                <a
                  href={`mailto:${info?.ios.requestEmail || "dispatch@delicate.co.za"}?subject=TestFlight invite for Delicate Driver`}
                  className="w-full h-12 rounded-xl bg-blue-500 text-text-primary font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                  data-testid="link-ios-request"
                >
                  <Mail className="w-4 h-4" />
                  Request TestFlight Invite
                </a>
              )}

              <ol className="text-xs text-text-tertiary space-y-1 list-decimal pl-4">
                <li>Install Apple's TestFlight app from the App Store.</li>
                <li>Open the invitation link dispatch sends you.</li>
                <li>Install Delicate Driver, then grant location "Always Allow" so tracking continues when the phone is locked.</li>
              </ol>
            </section>

            {!info?.android.available && !info?.ios.testflightUrl && onIOS && (
              <p className="text-xs text-text-quiet text-center">
                In the meantime, you can keep using the browser version — just keep the screen unlocked while on duty.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
