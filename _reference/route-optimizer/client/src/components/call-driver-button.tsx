import { useState } from "react";
import { createPortal } from "react-dom";
import { Phone, PhoneOff, PhoneCall, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTwilioCall, formatCallDuration } from "@/hooks/use-twilio-call";

interface CallDriverButtonProps {
  phone: string;
  driverName: string;
  variant?: "icon" | "chip" | "icon-green";
  testId?: string;
}

export function CallDriverButton({ phone, driverName, variant = "icon", testId }: CallDriverButtonProps) {
  const { isConfigured, status, error, duration, makeCall, hangUp, isInCall } = useTwilioCall();
  const [showCallUI, setShowCallUI] = useState(false);

  const handleCall = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (isInCall) {
      setShowCallUI(true);
      return;
    }
    if (!isConfigured) {
      window.location.href = `tel:${phone}`;
      return;
    }
    setShowCallUI(true);
    makeCall(phone);
  };

  const handleHangUp = () => {
    hangUp();
    setTimeout(() => setShowCallUI(false), 1500);
  };

  if (variant === "chip") {
    return (
      <>
        <button
          onClick={handleCall}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors text-[12px] font-semibold cursor-pointer border-0"
          title={`Call ${driverName}: ${phone}`}
          data-testid={testId}
        >
          <Phone className="w-3.5 h-3.5" />
          {phone}
        </button>
        {showCallUI && createPortal(
          <CallOverlay
            phone={phone}
            driverName={driverName}
            status={status}
            error={error}
            duration={duration}
            onHangUp={handleHangUp}
            onClose={() => { if (!isInCall) setShowCallUI(false); }}
          />,
          document.body
        )}
      </>
    );
  }

  if (variant === "icon-green") {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCall}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-green-50 dark:hover:bg-green-950/30 text-green-600 dark:text-green-400 cursor-pointer border-0 bg-transparent"
              data-testid={testId}
            >
              <Phone className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">Call {driverName}</p></TooltipContent>
        </Tooltip>
        {showCallUI && createPortal(
          <CallOverlay
            phone={phone}
            driverName={driverName}
            status={status}
            error={error}
            duration={duration}
            onHangUp={handleHangUp}
            onClose={() => { if (!isInCall) setShowCallUI(false); }}
          />,
          document.body
        )}
      </>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCall}
            className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors cursor-pointer border-0"
            title={`Call ${driverName}: ${phone}`}
            data-testid={testId}
          >
            <Phone className="w-3 h-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Call {driverName}: {phone}</p></TooltipContent>
      </Tooltip>
      {showCallUI && createPortal(
        <CallOverlay
          phone={phone}
          driverName={driverName}
          status={status}
          error={error}
          duration={duration}
          onHangUp={handleHangUp}
          onClose={() => { if (!isInCall) setShowCallUI(false); }}
        />,
        document.body
      )}
    </>
  );
}

function CallOverlay({ phone, driverName, status, error, duration, onHangUp, onClose }: {
  phone: string;
  driverName: string;
  status: string;
  error: string | null;
  duration: number;
  onHangUp: () => void;
  onClose: () => void;
}) {
  const statusLabel = {
    idle: "",
    connecting: "Connecting...",
    ringing: "Ringing...",
    "in-progress": formatCallDuration(duration),
    completed: "Call ended",
    failed: error || "Call failed",
  }[status] || "";

  const isActive = status === "connecting" || status === "ringing" || status === "in-progress";
  const isDone = status === "completed" || status === "failed";

  return (
    <div className="fixed bottom-6 right-6 z-[9999]" data-testid="call-overlay">
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-5 w-72">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${isActive ? "bg-green-500 animate-pulse" : isDone ? "bg-muted" : "bg-green-500/20"}`}>
              {isActive ? (
                <PhoneCall className="w-5 h-5 text-white" />
              ) : (
                <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
              )}
            </div>
            <div>
              <p className="text-[14px] font-bold leading-tight">{driverName}</p>
              <p className="text-[11px] text-muted-foreground">{phone}</p>
            </div>
          </div>
          {!isActive && (
            <button
              onClick={onClose}
              className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
              data-testid="button-close-call-overlay"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        <div className="text-center mb-4">
          {status === "connecting" && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[13px]">Connecting...</span>
            </div>
          )}
          {status === "ringing" && (
            <p className="text-[13px] text-amber-600 dark:text-amber-400 font-medium animate-pulse">Ringing...</p>
          )}
          {status === "in-progress" && (
            <p className="text-[22px] font-bold text-green-600 dark:text-green-400 tabular-nums">{formatCallDuration(duration)}</p>
          )}
          {status === "completed" && (
            <p className="text-[13px] text-muted-foreground">Call ended · {formatCallDuration(duration)}</p>
          )}
          {status === "failed" && (
            <p className="text-[13px] text-red-500">{error || "Call failed"}</p>
          )}
        </div>

        <div className="flex justify-center">
          {isActive ? (
            <Button
              onClick={onHangUp}
              className="bg-red-500 hover:bg-red-600 text-white rounded-full h-12 w-12 p-0"
              data-testid="button-hang-up"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
          ) : isDone ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-[12px]"
              data-testid="button-dismiss-call"
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default CallDriverButton;
