import { useState } from "react";
import { Loader2, Save, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDispatchExtras } from "@/hooks/use-dispatch-data";

const AVATAR_COLORS = ["#4a9eff", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function ProfilePanel() {
  const { authUser, onUpdateProfile } = useDispatchExtras();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({
    displayName: authUser?.displayName || "",
    email: authUser?.email || "",
    avatarColor: authUser?.avatarColor || "#4a9eff",
  });

  if (!authUser) {
    return <p className="text-text-secondary text-sm">Sign in to manage your profile.</p>;
  }

  async function save() {
    if (!onUpdateProfile) return;
    setSaving(true);
    try {
      await onUpdateProfile({
        displayName: data.displayName,
        email: data.email,
        avatarColor: data.avatarColor,
      });
      toast({ title: "Profile updated" });
      setEditing(false);
    } catch (err: any) {
      toast({ title: err.message || "Update failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="v7-settings-profile">
      <PanelHeader
        title="Profile"
        subtitle="How you appear to your team across the dispatch console."
        action={
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)} data-testid="v7-button-edit-profile">
            <Pencil className="size-3.5" />
            {editing ? "Cancel" : "Edit"}
          </Button>
        }
      />

      <div className="flex items-center gap-5">
        <div
          className="grid size-16 place-items-center rounded-full text-2xl font-semibold text-white"
          style={{ backgroundColor: data.avatarColor }}
          data-testid="v7-profile-avatar"
        >
          {(data.displayName || authUser.username).charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <p className="text-[16px] font-medium text-text-primary" data-testid="v7-profile-name">
            {data.displayName || authUser.username}
          </p>
          <p className="text-[12px] text-text-secondary">@{authUser.username}</p>
          <Badge variant="secondary" className="mt-1 text-[10px]">{authUser.role}</Badge>
        </div>
      </div>

      {editing && (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <Input label="Display name" value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} data-testid="v7-input-display-name" />
            <Input label="Email" type="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} data-testid="v7-input-email" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-text-quiet mb-2">Avatar colour</p>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setData({ ...data, avatarColor: c })}
                  className={`size-7 rounded-full border-2 transition-all ${data.avatarColor === c ? "border-text-primary scale-110" : "border-transparent opacity-70 hover:opacity-100"}`}
                  style={{ backgroundColor: c }}
                  data-testid={`v7-avatar-color-${c.slice(1)}`}
                  aria-label={`Choose colour ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" disabled={saving} onClick={save} data-testid="v7-button-save-profile">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save profile
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function PanelHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-2 border-b border-hairline">
      <div>
        <h2 className="font-display text-[24px] text-text-primary leading-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] text-text-secondary max-w-2xl">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
