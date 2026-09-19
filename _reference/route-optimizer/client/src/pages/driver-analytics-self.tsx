import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Download, FileText, Sheet as SheetIcon } from "lucide-react";
import { DriverAnalyticsView, type AnalyticsViewData } from "@/components/driver-analytics-view";

type Period = "7d" | "this_week" | "this_month" | "30d" | "ytd" | "12m";

interface AnalyticsResp extends AnalyticsViewData {
  driverName: string;
}

export default function DriverAnalyticsSelf() {
  const [, setLocation] = useLocation();
  const [period, setPeriod] = useState<Period>("7d");
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 50;
  const [error, setError] = useState<string | null>(null);
  const [manuallyRefreshing, setManuallyRefreshing] = useState(false);

  const token = useMemo(() => localStorage.getItem("driverToken"), []);

  useEffect(() => { setPage(1); }, [period]);

  const { data, isLoading, refetch } = useQuery<AnalyticsResp>({
    queryKey: ["/api/drivers/me/analytics", period, page],
    enabled: !!token,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!token) throw new Error("Missing driver token");
      const res = await fetch(
        `/api/drivers/me/analytics?period=${period}&page=${page}&pageSize=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) {
        setLocation("/driver/login");
        throw new Error("Unauthorized");
      }
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  async function downloadExport(kind: "csv" | "pdf" | "xlsx") {
    if (!token) { setLocation("/driver/login"); return; }
    try {
      const res = await fetch(`/api/drivers/me/analytics/export.${kind}?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { setLocation("/driver/login"); return; }
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-analytics-${period}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e?.message || "Download failed");
    }
  }

  const periodOptions: Array<{ key: Period; label: string }> = [
    { key: "7d", label: "7d" },
    { key: "this_week", label: "Week" },
    { key: "30d", label: "30d" },
    { key: "this_month", label: "Month" },
    { key: "ytd", label: "YTD" },
    { key: "12m", label: "12m" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 pb-24" data-testid="page-driver-analytics-self">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/driver/dashboard")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-lg font-semibold" data-testid="text-title">My Performance</h1>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              setManuallyRefreshing(true);
              try { await refetch(); } finally { setManuallyRefreshing(false); }
            }}
            disabled={manuallyRefreshing}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${manuallyRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadExport("csv")} data-testid="button-export-csv">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadExport("xlsx")} data-testid="button-export-xlsx">
            <SheetIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadExport("pdf")} data-testid="button-export-pdf">
            <FileText className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {periodOptions.map(({ key, label }) => (
          <Button
            key={key}
            size="sm"
            variant={period === key ? "default" : "outline"}
            onClick={() => setPeriod(key)}
            data-testid={`button-period-${key}`}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && <div className="text-red-400 text-sm mb-3" data-testid="text-error">{error}</div>}
      {isLoading && !data && <div className="text-slate-400 text-sm" data-testid="status-loading">Loading…</div>}
      {data && <DriverAnalyticsView data={data} variant="driver" onPageChange={setPage} />}
    </div>
  );
}
