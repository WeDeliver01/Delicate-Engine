import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Eye, EyeOff } from "lucide-react";
import bgDashboard from "@/assets/images/bg-dashboard-new.png";
import { login as driverLogin, getToken as getDriverToken } from "@/lib/driver-api";
import { isStandalone } from "@/lib/driver-pwa";

interface AuthPageProps {
  onAuth: (user: any) => void;
  login: (username: string, password: string) => Promise<any>;
  register: (username: string, password: string, displayName: string, email?: string) => Promise<any>;
}

export default function AuthPage({ onAuth, login }: AuthPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // If the dispatcher login screen has been opened from an iOS / Android
  // home-screen icon AND we already have a saved driver token, that almost
  // always means the user A2HS'd the wrong URL (root → /live → dispatcher
  // login) on a driver phone. Send them straight to the driver app instead
  // of asking them to re-type credentials in the wrong form.
  useEffect(() => {
    if (isStandalone() && getDriverToken()) {
      window.location.replace("/driver/dashboard");
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(username, password);
      onAuth(user);
    } catch (err: any) {
      // Dispatcher login failed. Before giving up, try the same credentials
      // against the driver-login endpoint — if they belong to a driver, we
      // silently sign them in and redirect to the driver app. This catches
      // the very common confusion where a driver opens the dispatcher URL
      // (root / saved-to-home-screen) and tries to sign in there.
      try {
        await driverLogin(username.trim().toLowerCase(), password, true);
        window.location.replace("/driver/dashboard");
        return;
      } catch {
        // Not a driver either — fall through to the original dispatcher error.
      }
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgDashboard})` }}
      />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <Card className="relative z-10 w-full max-w-md mx-4 bg-white/10 dark:bg-[#16213e]/80 backdrop-blur-xl border-white/20 shadow-2xl" data-testid="auth-card">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="flex items-center justify-center mb-4">
            <img src="/brand-logo.png?v=3" alt="Delicate Routes" className="h-24 w-auto object-contain drop-shadow-lg" data-testid="img-brand-logo" />
          </div>
          <h1 className="text-2xl font-bold text-white">Delicate Courier</h1>
          <p className="text-sm text-white/60 mt-1">Sign in to your dispatch account</p>
        </CardHeader>

        <CardContent className="px-6 pb-8 pt-4">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm" data-testid="auth-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-white/70 mb-1.5 block">Username</label>
              <Input
                data-testid="input-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[#4a9eff]"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-white/70 mb-1.5 block">Password</label>
              <div className="relative">
                <Input
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[#4a9eff] pr-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                  data-testid="toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#4a9eff] hover:bg-[#3a8eef] text-white font-semibold h-11 mt-2"
              data-testid="button-submit-auth"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
            </Button>

            <div className="pt-3 text-center">
              <a
                href="/driver/login"
                className="text-xs text-white/60 hover:text-white transition-colors underline-offset-4 hover:underline"
                data-testid="link-driver-login"
              >
                Are you a driver? Sign in here →
              </a>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
