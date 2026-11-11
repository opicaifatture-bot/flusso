"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/format";
import { leggiNumero } from "@/lib/controlli";
import { esegui } from "@/lib/azioni";

export type Campo = {
  nome: string; etichetta: string; tipo?: "testo" | "numero" | "data" | "dataora" | "select" | "area" | "check";
  opzioni?: { valore: string; etichetta: string }[]; richiesto?: boolean; aiuto?: string; iniziale?: string | boolean;
  segnaposto?: string; largo?: boolean;
};
type Props = {
  rpc: string;
  /** Parametri fissi della RPC. "@sede" e "@gruppo" vengono sostituiti dal server. */
  fissi?: Record<string, unknown>;
  campi: Campo[];
  /** Se indicato, i campi finiscono in questo parametro jsonb; altrimenti sono parametri diretti. */
  inDati?: string;
  /** Valori fissi da unire ai campi dentro il parametro jsonb. */
  datiFissi?: Record<string, unknown>;
  invio: string;
  /** Operazioni non reversibili o con impatto economico: chiede una conferma esplicita. */
  conferma?: string;
  fatto?: string;
  compatto?: boolean;
  /** Mostra un risultato che non sarà più recuperabile (es. una chiave). */
  risultato?: { chiave: string; etichetta: string; nota: string };
};

/** Modulo generico: raccoglie i campi, chiama la RPC e mostra l'esito. Tutti i controlli veri sono nel database. */
export function Modulo({ rpc, fissi = {}, campi, inDati, datiFissi, invio, conferma, fatto = "Salvato", compatto, risultato }: Props) {
  const router = useRouter();
  const id = useId();
  const [inCorso, avvia] = useTransition();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [segreto, setSegreto] = useState<string | null>(null);

  const invia = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const valori: Record<string, unknown> = {};
    for (const c of campi) {
      if (c.tipo === "check") { valori[c.nome] = fd.get(c.nome) === "on"; continue; }
      const grezzo = String(fd.get(c.nome) ?? "").trim();
      if (!grezzo) { if (!inDati) valori[c.nome] = null; continue; }
      if (c.tipo === "numero") {
        const n = leggiNumero(grezzo);
        if (n == null) return setEsito({ ok: false, testo: `${c.etichetta}: numero non valido` });
        valori[c.nome] = n;
      } else if (c.tipo === "dataora") valori[c.nome] = new Date(grezzo).toISOString();
      else valori[c.nome] = grezzo;
    }
    if (conferma && !window.confirm(conferma)) return;
    avvia(async () => {
      setEsito(null);
      // Con un parametro jsonb, i campi il cui nome inizia per "p_" restano parametri diretti della RPC.
      const diretti = Object.fromEntries(Object.entries(valori).filter(([k]) => k.startsWith("p_")));
      const interni = Object.fromEntries(Object.entries(valori).filter(([k]) => !k.startsWith("p_")));
      const r = await esegui<Record<string, unknown>>(rpc, inDati ? { ...fissi, ...diretti, [inDati]: { ...datiFissi, ...interni } } : { ...fissi, ...valori });
      if (!r.ok) return setEsito({ ok: false, testo: r.errore });
      setEsito({ ok: true, testo: fatto });
      if (risultato && r.dati && typeof r.dati === "object") setSegreto(String(r.dati[risultato.chiave] ?? ""));
      form.reset();
      router.refresh();
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); invia(e.currentTarget); }} className={cn("grid gap-3", compatto ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
      {campi.map((c) => {
        const cid = `${id}-${c.nome}`;
        const comuni = { id: cid, name: c.nome, required: c.richiesto, "aria-describedby": c.aiuto ? `${cid}-a` : undefined };
        return (
          <div key={c.nome} className={cn(c.largo && "sm:col-span-2", c.tipo === "check" && "flex items-center gap-2 self-end pb-1.5")}>
            {c.tipo === "check" ? (
              <><input {...comuni} type="checkbox" defaultChecked={c.iniziale === true} className="size-4 accent-[var(--ok)]" /><label htmlFor={cid} className="text-[13px]">{c.etichetta}</label></>
            ) : (
              <>
                <label htmlFor={cid} className="label">{c.etichetta}{!c.richiesto && <span className="font-normal text-subtle"> · facoltativo</span>}</label>
                {c.tipo === "select" ? (
                  <select {...comuni} defaultValue={String(c.iniziale ?? "")} className="input">
                    <option value="" disabled={c.richiesto}>{c.richiesto ? "Scegli…" : "—"}</option>
                    {c.opzioni?.map((o) => <option key={o.valore} value={o.valore}>{o.etichetta}</option>)}
                  </select>
                ) : c.tipo === "area" ? (
                  <textarea {...comuni} defaultValue={String(c.iniziale ?? "")} rows={2} placeholder={c.segnaposto} className="input h-auto py-1.5" />
                ) : (
                  <input {...comuni} defaultValue={String(c.iniziale ?? "")} placeholder={c.segnaposto}
                    type={c.tipo === "data" ? "date" : c.tipo === "dataora" ? "datetime-local" : "text"}
                    inputMode={c.tipo === "numero" ? "decimal" : undefined} className={cn("input", c.tipo === "numero" && "num")} />
                )}
              </>
            )}
            {c.aiuto && <p id={`${cid}-a`} className="mt-1 text-[11px] text-subtle">{c.aiuto}</p>}
          </div>
        );
      })}
      <div className={cn("flex flex-wrap items-center gap-3", compatto ? "sm:col-span-4" : "sm:col-span-2")}>
        <button disabled={inCorso} className="btn btn-primary">{inCorso ? "Attendere…" : invio}</button>
        <p role="status" aria-live="polite" className={cn("text-xs", esito?.ok ? "text-ok" : "text-danger")}>{esito?.testo}</p>
      </div>
      {segreto && risultato && (
        <div className={cn("rounded-lg border border-warn/30 bg-warn-soft p-3", compatto ? "sm:col-span-4" : "sm:col-span-2")}>
          <p className="text-xs font-medium text-warn">{risultato.etichetta}</p>
          <p className="num mt-1 select-all break-all text-xs">{segreto}</p>
          <p className="mt-1 text-[11px] text-muted">{risultato.nota}</p>
        </div>
      )}
    </form>
  );
}

/** Azione singola su un elemento. Con `motivo` chiede un testo obbligatorio; con `conferma` chiede conferma. */
export function Azione({ rpc, parametri, etichetta, conferma, motivo, stile = "btn btn-sm", fatto }: {
  rpc: string; parametri: Record<string, unknown>; etichetta: React.ReactNode; conferma?: string;
  motivo?: { parametro: string; domanda: string; facoltativo?: boolean }; stile?: string; fatto?: string;
}) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const vai = () => {
    const extra: Record<string, unknown> = {};
    if (motivo) {
      const testo = window.prompt(motivo.domanda);
      if (testo === null) return;
      if (!testo.trim() && !motivo.facoltativo) return setEsito({ ok: false, testo: "Il motivo è obbligatorio" });
      // "p_dati.campo" inserisce il motivo dentro un parametro jsonb già presente.
      const [par, campo] = motivo.parametro.split(".");
      if (campo) extra[par] = { ...(parametri[par] as Record<string, unknown>), [campo]: testo.trim() || null };
      else extra[par] = testo.trim() || null;
    }
    if (conferma && !window.confirm(conferma)) return;
    avvia(async () => {
      const r = await esegui(rpc, { ...parametri, ...extra });
      setEsito(r.ok ? (fatto ? { ok: true, testo: fatto } : null) : { ok: false, testo: r.errore });
      if (r.ok) router.refresh();
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={inCorso} onClick={vai} className={stile}>{etichetta}</button>
      {esito && <span role="status" className={cn("text-xs", esito.ok ? "text-ok" : "text-danger")}>{esito.testo}</span>}
    </span>
  );
}

/** Sezione richiudibile per i moduli secondari, così la pagina resta leggibile. */
export function Espandi({ titolo, children, aperto }: { titolo: string; children: React.ReactNode; aperto?: boolean }) {
  return (
    <details open={aperto} className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-medium">
        {titolo}<span aria-hidden className="text-subtle transition-transform duration-200 group-open:rotate-45">+</span>
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}
