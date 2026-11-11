"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { esegui } from "@/lib/azioni";
import { cn } from "@/lib/format";

export type Persona = { id: string; nome: string };
type Risposta = { ok: boolean; motivo?: string; esito?: string; suggerimento?: string; tentativi_rimasti?: number };

/** Scelta di chi registra + PIN. Obbligatoria con l'account Cucina, facoltativa per gli altri (firma l'utente). */
export function CampiOperatore({ persone, obbligatorio, id }: { persone: Persona[]; obbligatorio: boolean; id: string }) {
  return (
    <>
      <div><label className="label" htmlFor={`${id}-op`}>Chi registra{!obbligatorio && <span className="font-normal text-subtle"> · facoltativo</span>}</label>
        <select id={`${id}-op`} name="persona_id" required={obbligatorio} className="input" defaultValue=""><option value="">{obbligatorio ? "Scegli…" : "Io (utente collegato)"}</option>
          {persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
      <div><label className="label" htmlFor={`${id}-pin`}>PIN</label>
        <input id={`${id}-pin`} name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" required={obbligatorio} className="input num" /></div>
    </>
  );
}

export async function caricaFoto(sede: string, file: File | null) {
  if (!file || !file.size) return null;
  const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" } as Record<string, string>)[file.type];
  if (!ext) throw new Error("Formato della foto non supportato");
  if (file.size > 25 * 1024 * 1024) throw new Error("Foto troppo grande");
  const percorso = `${sede}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseBrowser().storage.from("archivio").upload(percorso, file, { contentType: file.type });
  if (error) throw new Error("Caricamento della foto non riuscito: " + error.message);
  return percorso;
}

export type CampoReg = { nome: string; etichetta: string; tipo?: "testo" | "numero" | "data" | "select" | "check" | "foto" | "area"; opzioni?: { valore: string; etichetta: string }[]; richiesto?: boolean; aiuto?: string; inDati?: boolean; iniziale?: string };

/** Registrazione firmata. I campi con inDati finiscono in dati (jsonb), gli altri sono campi della registrazione. */
export function Registra({ sede, persone, obbligatorio, base, campi, invio = "Registra", compatto, suggerimento }: {
  sede: string; persone: Persona[]; obbligatorio: boolean; base: Record<string, unknown>; campi: CampoReg[]; invio?: string; compatto?: boolean; suggerimento?: string | null;
}) {
  const router = useRouter();
  const id = useRef(`r${Math.random().toString(36).slice(2, 8)}`).current;
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [chiediAzione, setChiediAzione] = useState(false);
  const [inCorso, avvia] = useTransition();
  const invia = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    avvia(async () => {
      setEsito(null);
      try {
        const dati: Record<string, unknown> = { ...base }; const interni: Record<string, unknown> = { ...(base.dati as object) };
        for (const c of campi) {
          let v: unknown;
          if (c.tipo === "foto") v = await caricaFoto(sede, fd.get(c.nome) as File | null);
          else if (c.tipo === "check") v = fd.get(c.nome) === "on";
          else { const t = String(fd.get(c.nome) ?? "").trim(); v = t === "" ? undefined : c.tipo === "numero" ? Number(t.replace(",", ".")) : t; }
          if (v === undefined || v === null) continue;
          if (c.tipo === "numero" && Number.isNaN(v)) { setEsito({ ok: false, testo: `${c.etichetta}: numero non valido` }); return; }
          if (c.inDati) interni[c.nome] = v; else dati[c.nome] = v;
        }
        const azione = String(fd.get("azione_correttiva") ?? "").trim();
        if (azione) dati.azione_correttiva = azione;
        dati.dati = interni;
        const persona = String(fd.get("persona_id") ?? "") || null;
        const r = await esegui<Risposta>("registra", { p_ristorante_id: "@sede", p_persona_id: persona, p_pin: persona ? String(fd.get("pin") ?? "") : null, p_dati: dati });
        if (!r.ok) return setEsito({ ok: false, testo: r.errore });
        const x = r.dati!;
        if (!x.ok) {
          if (x.esito === "non_conforme") setChiediAzione(true);
          return setEsito({ ok: false, testo: x.motivo + (x.tentativi_rimasti !== undefined ? ` (tentativi rimasti: ${x.tentativi_rimasti})` : "") });
        }
        setEsito({ ok: true, testo: x.esito === "non_conforme" ? "Registrato come NON conforme, con l'azione correttiva" : "Registrato" });
        setChiediAzione(false); form.reset(); router.refresh();
      } catch (e) { setEsito({ ok: false, testo: (e as Error).message }); }
    });
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); invia(e.currentTarget); }} className={cn("grid gap-3", compatto ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
      {campi.map((c) => {
        const cid = `${id}-${c.nome}`;
        return (
          <div key={c.nome} className={cn(c.tipo === "area" && (compatto ? "sm:col-span-4" : "sm:col-span-2"), c.tipo === "check" && "flex items-center gap-2 self-end pb-1.5")}>
            {c.tipo === "check" ? (<><input id={cid} name={c.nome} type="checkbox" className="size-4" /><label htmlFor={cid} className="text-[13px]">{c.etichetta}</label></>) : (
              <>
                <label htmlFor={cid} className="label">{c.etichetta}{!c.richiesto && <span className="font-normal text-subtle"> · facoltativo</span>}</label>
                {c.tipo === "select" ? (
                  <select id={cid} name={c.nome} required={c.richiesto} defaultValue={c.iniziale ?? ""} className="input"><option value="" disabled={c.richiesto}>{c.richiesto ? "Scegli…" : "—"}</option>{c.opzioni?.map((o) => <option key={o.valore} value={o.valore}>{o.etichetta}</option>)}</select>
                ) : c.tipo === "foto" ? (
                  <input id={cid} name={c.nome} type="file" accept="image/*,application/pdf" capture="environment" className="block text-xs file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1" />
                ) : c.tipo === "area" ? (
                  <textarea id={cid} name={c.nome} required={c.richiesto} rows={2} className="input h-auto py-1.5" />
                ) : (
                  <input id={cid} name={c.nome} required={c.richiesto} defaultValue={c.iniziale} type={c.tipo === "data" ? "date" : "text"} inputMode={c.tipo === "numero" ? "decimal" : undefined} className={cn("input", c.tipo === "numero" && "num")} />
                )}
              </>
            )}
            {c.aiuto && <p className="mt-1 text-[11px] text-subtle">{c.aiuto}</p>}
          </div>
        );
      })}
      {chiediAzione && (
        <div className={compatto ? "sm:col-span-4" : "sm:col-span-2"}>
          <label className="label" htmlFor={`${id}-az`}>Azione correttiva</label>
          <input id={`${id}-az`} name="azione_correttiva" required className="input" defaultValue={suggerimento ?? ""} />
          {suggerimento && <p className="mt-1 text-[11px] text-subtle">Proposta dal piano: modificala se hai fatto altro.</p>}
        </div>
      )}
      <CampiOperatore persone={persone} obbligatorio={obbligatorio} id={id} />
      <div className={cn("flex flex-wrap items-center gap-3", compatto ? "sm:col-span-4" : "sm:col-span-2")}>
        <button disabled={inCorso} className="btn btn-primary">{inCorso ? "Attendere…" : invio}</button>
        <p role="status" aria-live="polite" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</p>
      </div>
    </form>
  );
}

/** Firma tracciata col dito o col mouse; restituisce un percorso SVG. */
export function TrattoFirma({ onChange }: { onChange: (svg: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const percorso = useRef<string[]>([]);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = getComputedStyle(c).color;
    let giu = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * c.width), Math.round(((e.clientY - r.top) / r.height) * c.height)]; };
    const start = (e: PointerEvent) => { giu = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); percorso.current.push(`M${x} ${y}`); c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!giu) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); percorso.current.push(`L${x} ${y}`); };
    const end = () => { if (!giu) return; giu = false; onChange(percorso.current.join(" ")); };
    c.addEventListener("pointerdown", start); c.addEventListener("pointermove", move); c.addEventListener("pointerup", end); c.addEventListener("pointerleave", end);
    return () => { c.removeEventListener("pointerdown", start); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", end); c.removeEventListener("pointerleave", end); };
  }, [onChange]);
  return (
    <div>
      <canvas ref={ref} width={600} height={160} aria-label="Riquadro per la firma" className="h-28 w-full touch-none rounded-md border border-line bg-raised text-fg" />
      <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); percorso.current = []; onChange(""); }}>Cancella</button>
    </div>
  );
}
