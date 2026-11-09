import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn, pct } from "@/lib/format";
import type { StatoAnomalia, StatoDocumento } from "@/lib/tipi";

type Tono = "neutro" | "ok" | "warn" | "danger" | "info";
const TONI: Record<Tono, string> = {
  neutro: "border-line bg-raised text-muted",
  ok: "border-ok/25 bg-ok-soft text-ok",
  warn: "border-warn/25 bg-warn-soft text-warn",
  danger: "border-danger/25 bg-danger-soft text-danger",
  info: "border-info/25 bg-info-soft text-info",
};

export function Badge({ tono = "neutro", pulsa, className, children }: {
  tono?: Tono; pulsa?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium", TONI[tono], className)}>
      {pulsa && <span className="size-1.5 animate-pulse-dot rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatoBadge({ stato, fase }: { stato: StatoDocumento; fase?: string | null }) {
  switch (stato) {
    case "in_coda": return <Badge pulsa>In coda</Badge>;
    case "elaborazione": return <Badge tono="info" pulsa>{fase === "abbinamento" ? "Abbinamento" : "Estrazione"}</Badge>;
    case "completato": return <Badge tono="ok">Completato</Badge>;
    case "duplicato": return <Badge tono="warn">Duplicato</Badge>;
    default: return <Badge tono="danger">Errore</Badge>;
  }
}

export function AnomaliaBadge({ stato }: { stato: StatoAnomalia | null }) {
  if (stato === "accettata") return <Badge tono="neutro">Approvato</Badge>;
  if (stato === "contestata") return <Badge tono="warn">Contestato</Badge>;
  return <Badge tono="danger">Da gestire</Badge>;
}

export function TipoBadge({ tipo }: { tipo: string }) {
  return <span className="whitespace-nowrap text-xs text-muted">{tipo}</span>;
}

export function Paese({ codice }: { codice: string | null | undefined }) {
  if (!codice) return null;
  return <span className="num rounded border border-line px-1 py-px text-[10px] leading-none text-subtle">{codice}</span>;
}

/** Variazione di prezzo: rubino se è un rincaro oltre soglia, smeraldo se è un risparmio. */
export function Variazione({ v, anomalia, className }: { v: number | null | undefined; anomalia?: boolean; className?: string }) {
  if (v === null || v === undefined) return <span className={cn("text-xs text-subtle", className)}>—</span>;
  const n = Number(v);
  const colore = anomalia ? "text-danger" : n > 0 ? "text-warn" : n < 0 ? "text-ok" : "text-muted";
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs font-medium", colore, className)}>
      {n > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : n < 0 ? <ArrowDownRight className="size-3" aria-hidden /> : null}
      {pct(n)}
    </span>
  );
}

export function Kpi({ etichetta, valore, nota, tono, href }: {
  etichetta: string; valore: React.ReactNode; nota?: React.ReactNode; tono?: "ok" | "warn" | "danger"; href?: string;
}) {
  const colore = tono === "ok" ? "text-ok" : tono === "warn" ? "text-warn" : tono === "danger" ? "text-danger" : "text-fg";
  const corpo = (
    <>
      <p className="eyebrow">{etichetta}</p>
      <p className={cn("num mt-3 text-2xl font-medium leading-none", colore)}>{valore}</p>
      {nota && <p className="mt-2 text-xs text-muted">{nota}</p>}
    </>
  );
  return href
    ? <Link href={href} className="card block p-4 transition-colors duration-150 hover:border-line-strong">{corpo}</Link>
    : <div className="card p-4">{corpo}</div>;
}

export function Intestazione({ titolo, sottotitolo, children }: { titolo: string; sottotitolo?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{titolo}</h1>
        {sottotitolo && <p className="mt-1 text-[13px] text-muted">{sottotitolo}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Vuoto({ titolo, children }: { titolo: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium">{titolo}</p>
      {children && <div className="mt-1.5 max-w-sm text-[13px] text-muted">{children}</div>}
    </div>
  );
}

export function Avviso({ tono = "danger", children }: { tono?: "danger" | "warn" | "info" | "ok"; children: React.ReactNode }) {
  return <div role="status" className={cn("rounded-lg border px-3 py-2 text-[13px]", TONI[tono])}>{children}</div>;
}

export function Schede({ voci, attiva }: { voci: { href: string; chiave: string; etichetta: string; conteggio?: number }[]; attiva: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {voci.map((v) => (
        <Link key={v.chiave} href={v.href} scroll={false}
          className={cn("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors duration-150",
            v.chiave === attiva ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg")}>
          {v.etichetta}
          {v.conteggio !== undefined && <span className="num rounded-full bg-raised px-1.5 text-[11px] text-muted">{v.conteggio}</span>}
        </Link>
      ))}
    </div>
  );
}
