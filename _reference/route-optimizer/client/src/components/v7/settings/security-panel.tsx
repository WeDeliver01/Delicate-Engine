import { useState } from "react";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";
import { PanelHeader } from "./profile-panel";

export function SecurityPanel() {
  const { authUser, onUpdateProfile } = useDispatchExtras();
  const { toast } = useToast();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);

  async function changePassword() {
    if (!onUpdateProfile) return;
    if (!pw.newPassword || pw.newPassword !== pw.confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await onUpdateProfile({
        displayName: authUser?.displayName ?? "",
        email: authUser?.email ?? "",
        avatarColor: authUser?.avatarColor ?? "#4a9eff",
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
      toast({ title: "Password updated" });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err: any) {
      toast({ title: err.message || "Update failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="v7-settings-security">
      <PanelHeader
        title="Security"
        subtitle="Rotate your dispatcher password. Sessions remain active after a change."
      />
      <div className="rounded-[var(--v7-radius-md,8px)] border border-hairline bg-surface-raised p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="size-4 text-jacaranda-300" />
          <p className="text-[13px] font-medium text-text-primary">Change password</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Input label="Current password" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} data-testid="v7-input-current-password" />
          <Input label="New password" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} data-testid="v7-input-new-password" />
          <Input label="Confirm new password" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} data-testid="v7-input-confirm-password" />
        </div>
        <div className="flex justify-end mt-5">
          <Button variant="primary" disabled={saving} onClick={changePassword} data-testid="v7-button-change-password">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Update password
          </Button>
        </div>
      </div>
    </div>
  );
}
