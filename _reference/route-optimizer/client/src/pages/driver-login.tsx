import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { login, getToken } from "@/lib/driver-api";
import { injectDriverManifest, setMobileViewportHeight, isIOS, isStandalone } from "@/lib/driver-pwa";
import { Loader2, Download, Eye, EyeOff, Share, PlusSquare } from "lucide-react";
import jacarandaBg from "@/assets/jacaranda-bg.png";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function DriverLogin() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const onIOS = isIOS();
  const alreadyInstalled = isStandalone();

  useEffect(() => {
    if (getToken()) setLocation("/driver/dashboard");
    injectDriverManifest();
    setMobileViewportHeight();
  }, [setLocation]);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      await login(username.trim().toLowerCase(), password, remember);
      setLocation("/driver/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleInstall() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
    } else if (onIOS) {
      setShowIOSGuide(!showIOSGuide);
    }
  }

  const showInstallButton = !alreadyInstalled && (!!installPrompt || onIOS);

  return (
    <div className="driver-fullscreen-min w-full grid grid-cols-1 lg:grid-cols-2" style={{ background: "linear-gradient(135deg, hsl(var(--v7-surface-inset)) 0%, hsl(var(--v7-surface-base)) 50%, hsl(var(--v7-jacaranda-900)) 100%)" }}>
      <aside className="hidden lg:flex flex-col justify-between p-12 xl:p-16 relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${jacarandaBg})` }} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(var(--v7-jacaranda-900) / 0.78) 0%, hsl(var(--v7-jacaranda-700) / 0.6) 55%, hsl(var(--v7-surface-inset) / 0.85) 100%)" }} />
        <div className="flex items-center gap-3 relative z-10">
          <img src="/favicon.png?v=3" alt="" className="w-12 h-12 rounded-2xl bg-white object-contain p-1 shadow-md" />
          <div>
            <div className="font-display text-lg font-medium text-text-primary">Delicate Courier</div>
            <div className="text-xs text-text-tertiary uppercase tracking-[0.18em]">Driver Companion</div>
          </div>
        </div>
        <div className="relative z-10">
          <h2 className="font-display text-4xl xl:text-5xl font-medium text-text-primary leading-tight">Pretoria's last mile,<br/>in your pocket.</h2>
          <p className="mt-4 text-base text-text-secondary max-w-md">Live routes, traffic-aware ETAs, one-tap stop actions, and instant dispatcher comms.</p>
        </div>
        <div className="text-xs text-text-quiet relative z-10">
          Need help? Speak to dispatch on +27 (0)12 003 5400.
        </div>
        <div className="absolute -right-32 -bottom-32 w-[480px] h-[480px] rounded-full" style={{ background: "radial-gradient(circle, hsl(var(--v7-jacaranda-400) / 0.25) 0%, transparent 70%)" }} aria-hidden="true" />
      </aside>
      <main className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/brand-logo.png?v=3" alt="Delicate Routes" className="h-24 w-auto mx-auto mb-3 object-contain drop-shadow-lg" data-testid="img-brand-logo" />
          <h1 className="text-2xl font-bold text-text-primary" data-testid="text-app-title">Delicate Driver</h1>
          <p className="text-sm text-text-tertiary mt-1">Courier companion app</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl p-6 space-y-4" style={{ background: "hsl(var(--v7-surface-raised))", border: "1px solid hsl(var(--v7-border-soft))", boxShadow: "var(--v7-shadow-lg)" }}>
            {error && (
              <div className="bg-red-500/15 border border-red-500/40 text-sm rounded-lg p-3" style={{ color: "hsl(var(--v7-danger))" }} data-testid="text-login-error">
                {error}
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Username</label>
              <input
                data-testid="input-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-12 px-4 rounded-lg text-text-primary placeholder:text-text-quiet text-base focus:outline-none focus:border-jacaranda-500 focus:ring-1 focus:ring-jacaranda-500"
                style={{ background: "hsl(var(--v7-surface-inset))", border: "1px solid hsl(var(--v7-border-soft))" }}
                placeholder="Enter username"
                autoCapitalize="none"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Password</label>
              <div className="relative">
                <input
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 pr-12 rounded-lg text-text-primary placeholder:text-text-quiet text-base focus:outline-none focus:border-jacaranda-500 focus:ring-1 focus:ring-jacaranda-500"
                  style={{ background: "hsl(var(--v7-surface-inset))", border: "1px solid hsl(var(--v7-border-soft))" }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-border-soft bg-surface-raised text-jacaranda-500 accent-jacaranda-500"
              data-testid="input-remember"
            />
            <span className="text-sm text-text-secondary">Remember me</span>
          </label>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full h-12 rounded-xl bg-jacaranda-500 hover:bg-jacaranda-600 text-white font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-all shadow-md"
            data-testid="button-login"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
          </button>
        </form>

        {showInstallButton && (
          <button
            onClick={handleInstall}
            className="w-full mt-4 h-12 rounded-xl border border-jacaranda-400/40 text-jacaranda-400 font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            data-testid="button-install-pwa"
          >
            <Download className="w-4 h-4" />
            Install App
          </button>
        )}

        {showIOSGuide && onIOS && (
          <div className="mt-3 rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--v7-jacaranda-500) / 0.12)", border: "1px solid rgba(74,158,255,0.2)" }} data-testid="ios-install-guide">
            <p className="text-sm font-medium text-text-primary">Install on iPhone / iPad</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm text-text-secondary">
                <div className="w-6 h-6 rounded-full bg-jacaranda-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-jacaranda-400">1</div>
                <span className="flex items-center gap-1">Tap the <Share className="w-4 h-4 text-jacaranda-400 inline" /> Share button</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-text-secondary">
                <div className="w-6 h-6 rounded-full bg-jacaranda-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-jacaranda-400">2</div>
                <span className="flex items-center gap-1">Scroll down, tap <PlusSquare className="w-4 h-4 text-jacaranda-400 inline" /> Add to Home Screen</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-text-secondary">
                <div className="w-6 h-6 rounded-full bg-jacaranda-500/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-jacaranda-400">3</div>
                <span>Tap Add to confirm</span>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setLocation("/driver/install")}
          className="w-full mt-3 h-10 rounded-lg text-xs text-text-tertiary border border-hairline/60 bg-surface-overlay/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          data-testid="link-install-native-app"
        >
          <Download className="w-3.5 h-3.5" />
          Install the native app for 24/7 background tracking
        </button>

        <p className="text-center text-xs text-text-quiet mt-6">Delicate Courier &copy; {new Date().getFullYear()}</p>
        </div>
      </main>
    </div>
  );
}
