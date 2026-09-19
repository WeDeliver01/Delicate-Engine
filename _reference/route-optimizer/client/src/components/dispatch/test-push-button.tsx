import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TestPushResult {
  ok: boolean;
  kind: string;
  sent: number;
  pruned: number;
  failed: number;
  skipped?: "messaging-disabled" | "no-tokens" | "error";
  configured: boolean;
}

interface PushStatus {
  configured: boolean;
}

interface Props {
  driverName: string;
  size?: "sm" | "icon";
  variant?: "ghost" | "outline";
  className?: string;
  testIdSuffix?: string;
}

export function TestPushButton({
  driverName,
  size = "sm",
  variant = "ghost",
  className,
  testIdSuffix,
}: Props) {
  const { toast } = useToast();
  const status = useQuery<PushStatus>({
    queryKey: ["/api/driver/push/status"],
    staleTime: 60_000,
  });
  const configured = status.data?.configured === true;
  const statusUnknown = status.isLoading || status.isError || status.data === undefined;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/driver/push/test", {
        driverName,
        kind: "test",
        title: "Delicate Driver test",
        body: `Dispatcher ping for ${driverName} — push is working.`,
      });
      return (await res.json()) as TestPushResult;
    },
    onSuccess: (data) => {
      if (data.skipped === "messaging-disabled" || !data.configured) {
        toast({
          title: "Push not configured",
          description: "Set FIREBASE_SERVICE_ACCOUNT_JSON to enable push.",
          variant: "destructive",
        });
        return;
      }
      if (data.skipped === "no-tokens") {
        toast({
          title: `${driverName} has no devices`,
          description: "The driver hasn't enabled push notifications on any device yet.",
        });
        return;
      }
      if (data.skipped === "error") {
        toast({
          title: "Push send failed",
          description: "Something went wrong sending the test push.",
          variant: "destructive",
        });
        return;
      }
      const parts: string[] = [`${data.sent} sent`];
      if (data.pruned) parts.push(`${data.pruned} pruned`);
      if (data.failed) parts.push(`${data.failed} failed`);
      toast({
        title: `Test push sent to ${driverName}`,
        description: parts.join(" · "),
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Could not send test push",
        description: message,
        variant: "destructive",
      });
    },
  });

  const disabled = !configured || mutation.isPending;
  const title = statusUnknown
    ? "Checking push notification status…"
    : !configured
      ? "Push notifications are not configured (FIREBASE_SERVICE_ACCOUNT_JSON is missing)"
      : `Send a test push to ${driverName}`;
  const suffix = testIdSuffix ?? driverName.toLowerCase().replace(/\s+/g, "-");

  if (size === "icon") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) mutation.mutate();
        }}
        disabled={disabled}
        title={title}
        aria-label={title}
        data-testid={`button-test-push-${suffix}`}
        className={
          className ??
          "grid size-7 place-items-center rounded-full border border-hairline bg-surface-overlay text-text-secondary transition-colors hover:bg-jacaranda-500/10 hover:text-jacaranda-400 hover:border-jacaranda-400/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-overlay disabled:hover:text-text-secondary disabled:hover:border-hairline"
        }
      >
        {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate();
      }}
      title={title}
      data-testid={`button-test-push-${suffix}`}
      className={className}
    >
      {mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
      Test push
    </Button>
  );
}
