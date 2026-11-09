export function BadgeAnomalia({ n }: { n: number }) {
  if (!n) return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">OK</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">
      ▲ {n} {n === 1 ? "rincaro" : "rincari"}
    </span>
  );
}

export function BadgeTipo({ tipo }: { tipo: string }) {
  const c: Record<string, string> = {
    Fattura: "bg-stone-100 text-stone-700",
    DDT: "bg-sky-50 text-sky-700",
    "Nota di Credito": "bg-violet-50 text-violet-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${c[tipo] ?? "bg-stone-100 text-stone-600"}`}>{tipo}</span>;
}

export function Variazione({ v, anomalia }: { v: number | null; anomalia: boolean }) {
  if (v === null || v === undefined) return <span className="text-stone-400">primo acquisto</span>;
  const n = Number(v);
  const cls = anomalia ? "bg-red-600 text-white" : n > 0 ? "text-amber-700" : n < 0 ? "text-emerald-700" : "text-stone-500";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>{n > 0 ? "+" : ""}{n.toLocaleString("it-IT")}%</span>;
}

export function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "red" }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === "red" ? "text-red-600" : ""}`}>{value}</p>
    </div>
  );
}
