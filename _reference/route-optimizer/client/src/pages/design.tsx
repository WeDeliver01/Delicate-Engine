import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, FloatingInput } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { DriverChip } from "@/components/ui/driver-chip";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Truck, MapPin, AlertTriangle, Plus } from "lucide-react";

function Section({ title, kicker, children }: { title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        {kicker && <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">{kicker}</div>}
        <h2 className="font-display text-2xl tracking-tight text-text-primary">{title}</h2>
      </div>
      <div className="rounded-[var(--v7-radius-xl)] border border-hairline bg-surface-raised p-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-4 py-3 first:pt-0 last:pb-0 border-b border-hairline last:border-0">
      <div className="text-xs uppercase tracking-[0.14em] text-text-quiet">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function DesignPage() {
  const { toast } = useToast();
  const [n, setN] = useState(1240);

  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="min-h-screen w-full bg-surface-base text-text-primary">
      <header className="border-b border-hairline bg-surface-base/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-8 py-6 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">v7 design system</div>
            <h1 className="font-display text-3xl tracking-tight">Foundation — Tokens, Fonts &amp; Primitives</h1>
          </div>
          <StatusPill tone="brand" dot>preview</StatusPill>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-8 py-10 space-y-10">

        <Section kicker="01" title="Typography">
          <div className="space-y-4">
            <div className="font-display text-5xl tracking-tight">Fraunces — display</div>
            <div className="font-sans text-2xl">Inter — sans</div>
            <div className="font-mono text-base text-text-secondary">JetBrains Mono — 12.34</div>
          </div>
        </Section>

        <Section kicker="02" title="Surfaces &amp; Hairlines">
          <div className="grid grid-cols-4 gap-3">
            {(["base", "raised", "overlay", "inset"] as const).map((s) => (
              <div key={s} className={`rounded-[var(--v7-radius-md)] border border-hairline bg-surface-${s} p-4 h-24 flex flex-col justify-between`}>
                <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">surface</div>
                <div className="text-sm text-text-primary">{s}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md border border-hairline bg-surface-raised p-3 text-xs text-text-tertiary">hairline</div>
            <div className="rounded-md border border-border-soft bg-surface-raised p-3 text-xs text-text-tertiary">border-soft</div>
            <div className="rounded-md border border-border-strong bg-surface-raised p-3 text-xs text-text-tertiary">border-strong</div>
          </div>
        </Section>

        <Section kicker="03" title="Jacaranda scale">
          <div className="flex gap-1 overflow-hidden rounded-[var(--v7-radius-md)]">
            {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
              <div key={w} className={`flex-1 h-16 bg-jacaranda-${w} flex items-end justify-center text-[10px] pb-1 ${w >= 500 ? "text-ivory" : "text-jacaranda-900"}`}>{w}</div>
            ))}
          </div>
          <div className="mt-3 h-16 rounded-[var(--v7-radius-md)] bg-jacaranda-gradient flex items-center justify-center text-ivory font-display text-lg tracking-tight">jacaranda gradient</div>
        </Section>

        <Section kicker="04" title="Buttons">
          <Row label="Primary"><Button>Primary</Button><Button size="sm">Small</Button><Button size="lg">Large</Button><Button disabled>Disabled</Button></Row>
          <Row label="Secondary"><Button variant="secondary">Secondary</Button><Button variant="secondary" size="sm">Small</Button><Button variant="secondary" disabled>Disabled</Button></Row>
          <Row label="Ghost"><Button variant="ghost">Ghost</Button><Button variant="ghost" size="sm">Small</Button></Row>
          <Row label="Outline"><Button variant="outline">Outline</Button></Row>
          <Row label="Destructive"><Button variant="destructive">Destructive</Button></Row>
          <Row label="Icon"><Button size="icon"><Plus /></Button><Button size="icon" variant="secondary"><Plus /></Button></Row>
        </Section>

        <Section kicker="05" title="Cards">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-display tracking-tight">Default card</CardTitle>
                <CardDescription>Hairline border, hover lift.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-text-secondary">Hover me to see the lift effect.</CardContent>
            </Card>
            <Card grain>
              <CardHeader>
                <CardTitle className="font-display tracking-tight">Grain card</CardTitle>
                <CardDescription>Subtle film-grain overlay.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-text-secondary">Same primitive, with the <code className="font-mono text-jacaranda-300">grain</code> prop.</CardContent>
            </Card>
          </div>
        </Section>

        <Section kicker="06" title="Inputs">
          <Row label="Standard"><div className="w-72"><Input placeholder="Search shipments…" /></div></Row>
          <Row label="Floating label"><div className="w-72"><FloatingInput label="Customer name" /></div><div className="w-72"><FloatingInput label="Pickup address" defaultValue="221B Baker St" /></div></Row>
          <Row label="Disabled"><div className="w-72"><Input placeholder="Disabled" disabled /></div></Row>
        </Section>

        <Section kicker="07" title="Status pills">
          <Row label="Tones">
            <StatusPill>neutral</StatusPill>
            <StatusPill tone="success" dot>delivered</StatusPill>
            <StatusPill tone="warning" dot>delayed</StatusPill>
            <StatusPill tone="danger" dot>failed</StatusPill>
            <StatusPill tone="info" dot>en route</StatusPill>
            <StatusPill tone="brand">priority</StatusPill>
          </Row>
          <Row label="Sizes">
            <StatusPill size="sm" tone="success">sm</StatusPill>
            <StatusPill size="md" tone="success">md</StatusPill>
            <StatusPill size="lg" tone="success">lg</StatusPill>
          </Row>
        </Section>

        <Section kicker="08" title="Driver chips">
          <Row label="All four">
            <DriverChip driver="vinny" />
            <DriverChip driver="ashley" />
            <DriverChip driver="refiloe" />
            <DriverChip driver="clifford" />
          </Row>
          <Row label="Sizes">
            <DriverChip driver="vinny" size="sm" />
            <DriverChip driver="ashley" size="md" />
            <DriverChip driver="refiloe" size="lg" />
          </Row>
          <Row label="Avatar only">
            <DriverChip driver="vinny" showName={false} />
            <DriverChip driver="ashley" showName={false} />
            <DriverChip driver="refiloe" showName={false} />
            <DriverChip driver="clifford" showName={false} />
          </Row>
        </Section>

        <Section kicker="09" title="Metric cards">
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="Active routes" value={n} icon={<Truck className="size-4" />} delta={12} deltaLabel="vs yesterday" tone="brand" />
            <MetricCard label="On-time" value={94.6} unit="%" delta={-1.2} format={(x) => x.toFixed(1)} tone="success" />
            <MetricCard label="Stops left" value={48} delta={0} icon={<MapPin className="size-4" />} />
            <MetricCard label="Exceptions" value={3} icon={<AlertTriangle className="size-4" />} delta={50} tone="danger" />
          </div>
          <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => setN((v) => v + Math.round(Math.random() * 200 - 100))}>animate <AnimatedNumber value={n} className="ml-1 font-mono" /></Button></div>
        </Section>

        <Section kicker="10" title="Empty state">
          <EmptyState
            icon={<Inbox className="size-5" />}
            title="No shipments today"
            description="When new shipments arrive, they'll appear here ready to assign and dispatch."
            action={<Button>Import CSV</Button>}
          />
        </Section>

        <Section kicker="11" title="Toasts">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => toast({ title: "Saved", description: "Route updated successfully." })}>default</Button>
            <Button variant="secondary" onClick={() => toast({ variant: "destructive", title: "Failed", description: "Couldn't reach driver." })}>destructive</Button>
            <Button variant="secondary" onClick={() => toast({ variant: "success", title: "Delivered", description: "All stops complete." })}>success</Button>
            <Button variant="secondary" onClick={() => toast({ variant: "warning", title: "Delayed", description: "Traffic on N1." })}>warning</Button>
            <Button variant="secondary" onClick={() => toast({ variant: "info", title: "Heads up", description: "New ETA: 14:32." })}>info</Button>
          </div>
        </Section>

        <Section kicker="12" title="Shadows &amp; radii">
          <div className="grid grid-cols-3 gap-4">
            {(["v7-sm", "v7-md", "v7-lg"] as const).map((s) => (
              <div key={s} className={`rounded-[var(--v7-radius-lg)] bg-surface-raised border border-hairline p-6 shadow-${s} text-sm text-text-tertiary`}>shadow-{s}</div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-5 gap-3">
            {([
              ["sm", "var(--v7-radius-sm)"],
              ["md", "var(--v7-radius-md)"],
              ["lg", "var(--v7-radius-lg)"],
              ["xl", "var(--v7-radius-xl)"],
              ["pill", "var(--v7-radius-pill)"],
            ] as const).map(([k, v]) => (
              <div key={k} className="bg-jacaranda-500/20 border border-jacaranda-400/30 p-4 text-center text-xs text-text-secondary" style={{ borderRadius: v }}>radius-{k}</div>
            ))}
          </div>
        </Section>

      </main>
    </div>
  );
}
