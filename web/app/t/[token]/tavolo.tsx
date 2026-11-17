"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Bell, Droplets, Minus, Plus, Receipt, ShoppingBag, Wheat } from "lucide-react";
import { cn } from "@/lib/format";
import { chiama, ordina, paga, statoTavolo } from "./actions";
import { ALLERGENI, NOMI_LINGUE, testi, type Lingua } from "./testi";

type Voce = { id: string; categoria: string; nome: string; descrizione: string | null; prezzo: number; esaurito: boolean;
  traduzioni: Record<string, { nome?: string; descrizione?: string }>; allergeni: { contiene: string[]; tracce: string[]; incompleto: boolean } };
type RigaConto = { id: string; nome: string; prezzo: number; quantita: number; totale: number; stato: string };
type Conto = { righe: RigaConto[]; coperti: number | null; coperto: number; totale: number; pagato: number; da_pagare: number; righe_pagate: string[] };
type Stato = { stato: string; sede?: string; tavolo?: string; lingue?: Lingua[]; ordini_cliente?: boolean; mance?: boolean; pagamento?: string;
  menu?: Voce[]; ordini?: { nome: string; quantita: number; stato: string; uscita: number }[]; conto?: Conto };

const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export function Tavolo({ token }: { token: string }) {
  const [s, setS] = useState<Stato | null>(null);
  const [lingua, setLingua] = useState<Lingua>("it");
  const [scheda, setScheda] = useState<"menu" | "ordine" | "conto">("menu");
  const [carrello, setCarrello] = useState<Record<string, { q: number; note: string }>>({});
  const [esclusi, setEsclusi] = useState<string[]>([]);
  const [avviso, setAvviso] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const t = testi(lingua);

  const aggiorna = useCallback(async () => {
    const r = await statoTavolo(token);
    setS(r.ok ? (r.dati as Stato) : { stato: "non_valido" });
  }, [token]);
  useEffect(() => {
    aggiorna();
    try { const l = navigator.language.slice(0, 2) as Lingua; if (l in NOMI_LINGUE) setLingua(l); } catch {}
    const id = setInterval(aggiorna, 8000);
    return () => clearInterval(id);
  }, [aggiorna]);

  const lingue = (s?.lingue ?? ["it"]).filter((l) => l in NOMI_LINGUE);
  const nomeVoce = (v: Voce) => v.traduzioni?.[lingua]?.nome || v.nome;
  const descrVoce = (v: Voce) => v.traduzioni?.[lingua]?.descrizione || v.descrizione;
  const categorie = useMemo(() => {
    const m = new Map<string, Voce[]>();
    for (const v of s?.menu ?? []) { if (esclusi.some((a) => v.allergeni.contiene.includes(a))) continue; m.set(v.categoria, [...(m.get(v.categoria) ?? []), v]); }
    return [...m.entries()];
  }, [s?.menu, esclusi]);
  const nelCarrello = Object.entries(carrello).filter(([, x]) => x.q > 0);
  const totaleCarrello = nelCarrello.reduce((tot, [id, x]) => tot + (s?.menu?.find((v) => v.id === id)?.prezzo ?? 0) * x.q, 0);
  const segnala = (ok: boolean, testo: string) => { setAvviso({ ok, testo }); setTimeout(() => setAvviso(null), 5000); };

  if (!s) return <div className="grid min-h-dvh place-items-center text-sm text-muted">…</div>;
  if (s.stato === "non_valido" || s.stato === "chiuso") return (
    <main className="grid min-h-dvh place-items-center p-6 text-center"><div><p className="text-lg font-semibold">{s.sede ?? ""}</p>
      {s.tavolo && <p className="text-sm text-muted">{t.tavolo} {s.tavolo}</p>}
      <p className="mt-4 max-w-xs text-sm">{s.stato === "chiuso" ? t.chiuso : t.nonValido}</p>
      <button className="btn mt-4" onClick={aggiorna}>↻</button></div></main>
  );

  const quantita = (id: string, d: number) => setCarrello((c) => ({ ...c, [id]: { q: Math.max(0, Math.min(20, (c[id]?.q ?? 0) + d)), note: c[id]?.note ?? "" } }));
  const inviaOrdine = () => avvia(async () => {
    const righe = nelCarrello.map(([voce_id, x]) => ({ voce_id, quantita: x.q, note: x.note || undefined }));
    const r = await ordina(token, righe, lingua);
    if (!r.ok) return segnala(false, r.errore);
    setCarrello({}); setScheda("ordine"); segnala(true, t.inviato); aggiorna();
  });
  const richiesta = (tipo: "cameriere" | "conto" | "acqua" | "pane") => avvia(async () => {
    const r = await chiama(token, tipo); segnala(r.ok, r.ok ? t.chiamato : r.errore); aggiorna();
  });

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-40">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{s.sede}</p><p className="text-xs text-muted">{t.tavolo} {s.tavolo}</p></div>
          {lingue.length > 1 && <select aria-label="Lingua" value={lingua} onChange={(e) => setLingua(e.target.value as Lingua)} className="input h-8 w-auto text-xs">
            {lingue.map((l) => <option key={l} value={l}>{NOMI_LINGUE[l]}</option>)}</select>}
        </div>
        <nav className="mt-3 grid grid-cols-3 gap-1 text-sm" aria-label="Sezioni">
          {(["menu", "ordine", "conto"] as const).map((k) => (
            <button key={k} onClick={() => setScheda(k)} aria-current={scheda === k ? "page" : undefined}
              className={cn("rounded-md py-1.5", scheda === k ? "bg-fg text-bg font-medium" : "bg-raised text-muted")}>{t[k]}</button>
          ))}
        </nav>
      </header>
      {avviso && <p role="status" className={cn("mx-4 mt-3 rounded-md px-3 py-2 text-sm", avviso.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger")}>{avviso.testo}</p>}
      {s.stato === "conto_richiesto" && <p className="mx-4 mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{t.contoRichiesto}</p>}

      {scheda === "menu" && (
        <main className="px-4">
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">{t.filtro}{esclusi.length ? ` (${esclusi.length})` : ""}</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">{Object.keys(ALLERGENI).map((a) => (
              <button key={a} onClick={() => setEsclusi((e) => e.includes(a) ? e.filter((x) => x !== a) : [...e, a])}
                className={cn("rounded-full border px-2.5 py-1 text-xs", esclusi.includes(a) ? "border-fg bg-fg text-bg" : "border-line")}>{ALLERGENI[a][lingua]}</button>
            ))}</div><p className="mt-2 text-xs text-muted">{t.allergeniInfo}</p></details>
          {categorie.map(([cat, voci]) => (
            <section key={cat} className="mt-5"><h2 className="eyebrow mb-2">{cat}</h2>
              <ul className="space-y-2">{voci.map((v) => (
                <li key={v.id} className={cn("card p-3", v.esaurito && "opacity-50")}>
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{nomeVoce(v)}</p>
                      {descrVoce(v) && <p className="mt-0.5 text-sm text-muted">{descrVoce(v)}</p>}
                      {(v.allergeni.contiene.length > 0 || v.allergeni.tracce.length > 0) && <p className="mt-1 text-xs text-muted">
                        {v.allergeni.contiene.length > 0 && <>{t.contiene}: <strong>{v.allergeni.contiene.map((a) => ALLERGENI[a]?.[lingua] ?? a).join(", ")}</strong>. </>}
                        {v.allergeni.tracce.length > 0 && <>{t.tracce}: {v.allergeni.tracce.map((a) => ALLERGENI[a]?.[lingua] ?? a).join(", ")}.</>}</p>}
                      {v.allergeni.incompleto && <p className="mt-1 text-xs text-warn">{t.incompleto}</p>}
                    </div>
                    <div className="text-right"><p className="num font-medium">{euro(v.prezzo)}</p>
                      {v.esaurito ? <p className="text-xs text-danger">{t.esaurito}</p> : s.ordini_cliente && s.stato !== "conto_richiesto" && (
                        carrello[v.id]?.q ? <div className="mt-2 flex items-center gap-2">
                          <button aria-label="−" className="btn btn-sm px-2" onClick={() => quantita(v.id, -1)}><Minus className="size-3.5" /></button>
                          <span className="num w-4 text-center">{carrello[v.id].q}</span>
                          <button aria-label="+" className="btn btn-sm px-2" onClick={() => quantita(v.id, 1)}><Plus className="size-3.5" /></button></div>
                        : <button className="btn btn-sm mt-2" onClick={() => quantita(v.id, 1)}>{t.aggiungi}</button>)}
                    </div>
                  </div>
                  {carrello[v.id]?.q > 0 && <input aria-label={t.note} placeholder={t.note} value={carrello[v.id].note} maxLength={200}
                    onChange={(e) => setCarrello((c) => ({ ...c, [v.id]: { ...c[v.id], note: e.target.value } }))} className="input mt-2 text-sm" />}
                </li>
              ))}</ul></section>
          ))}
        </main>
      )}

      {scheda === "ordine" && (
        <main className="px-4 pt-3">
          {(s.ordini ?? []).length ? <ul className="card divide-y divide-line">{s.ordini!.map((o, i) => (
            <li key={i} className="flex items-center justify-between p-3 text-sm"><span>{o.quantita}× {o.nome}</span>
              <span className={cn("text-xs", o.stato === "pronto" ? "text-ok" : "text-muted")}>{t.stati[o.stato as keyof typeof t.stati] ?? o.stato}</span></li>
          ))}</ul> : <p className="text-sm text-muted">{t.vuoto}</p>}
        </main>
      )}

      {scheda === "conto" && s.conto && <PannelloConto token={token} conto={s.conto} t={t} mance={!!s.mance} prova={s.pagamento !== "attivo"} onFatto={aggiorna} />}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-xl space-y-2">
          {nelCarrello.length > 0 && scheda === "menu" && (
            <button disabled={inCorso} onClick={inviaOrdine} className="btn btn-primary h-11 w-full justify-between">
              <span className="flex items-center gap-2"><ShoppingBag className="size-4" />{t.invia} ({nelCarrello.reduce((n, [, x]) => n + x.q, 0)})</span><span className="num">{euro(totaleCarrello)}</span></button>
          )}
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <button disabled={inCorso} onClick={() => richiesta("cameriere")} className="btn h-12 flex-col gap-0.5"><Bell className="size-4" />{t.cameriere}</button>
            <button disabled={inCorso} onClick={() => richiesta("acqua")} className="btn h-12 flex-col gap-0.5"><Droplets className="size-4" />{t.acqua}</button>
            <button disabled={inCorso} onClick={() => richiesta("pane")} className="btn h-12 flex-col gap-0.5"><Wheat className="size-4" />{t.pane}</button>
            <button disabled={inCorso} onClick={() => richiesta("conto")} className="btn h-12 flex-col gap-0.5"><Receipt className="size-4" />{t.chiediConto}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PannelloConto({ token, conto, t, mance, prova, onFatto }: { token: string; conto: Conto; t: ReturnType<typeof testi>; mance: boolean; prova: boolean; onFatto: () => void }) {
  const [modo, setModo] = useState<"tutto" | "uguale" | "piatti" | "importo">("tutto");
  const [parti, setParti] = useState(conto.coperti ?? 2);
  const [scelte, setScelte] = useState<string[]>([]);
  const [libero, setLibero] = useState("");
  const [manciaPct, setManciaPct] = useState(0);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const nonPagate = conto.righe.filter((r) => !conto.righe_pagate.includes(r.id));
  const importo = Math.min(conto.da_pagare, Math.round(100 * (
    modo === "tutto" ? conto.da_pagare : modo === "uguale" ? conto.da_pagare / Math.max(1, parti)
    : modo === "piatti" ? conto.righe.filter((r) => scelte.includes(r.id)).reduce((s, r) => s + r.totale, 0) : Number(libero.replace(",", ".")) || 0)) / 100);
  const mancia = Math.round(importo * manciaPct) / 100;
  return (
    <main className="px-4 pt-3">
      <ul className="card divide-y divide-line text-sm">
        {conto.righe.map((r) => <li key={r.id} className="flex justify-between p-3"><span>{r.quantita}× {r.nome}</span><span className="num">{euro(r.totale)}</span></li>)}
        {conto.coperto > 0 && <li className="flex justify-between p-3"><span>{t.coperto} × {conto.coperti}</span><span className="num">{euro(conto.coperto)}</span></li>}
        <li className="flex justify-between p-3 font-semibold"><span>{t.totale}</span><span className="num">{euro(conto.totale)}</span></li>
        {conto.pagato > 0 && <li className="flex justify-between p-3 text-ok"><span>{t.pagato}</span><span className="num">− {euro(conto.pagato)}</span></li>}
        <li className="flex justify-between p-3 font-semibold"><span>{t.daPagare}</span><span className="num">{euro(conto.da_pagare)}</span></li>
      </ul>
      {conto.da_pagare > 0 ? (
        <section className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-1.5 text-sm">{(["tutto", "uguale", "piatti", "importo"] as const).map((m) => (
            <button key={m} onClick={() => setModo(m)} className={cn("rounded-md border py-2", modo === m ? "border-fg bg-fg text-bg" : "border-line")}>{t[m]}</button>))}</div>
          {modo === "uguale" && <label className="flex items-center justify-between text-sm">{t.persone}
            <input type="number" min={2} max={30} value={parti} onChange={(e) => setParti(Math.max(1, Number(e.target.value)))} className="input num w-20" /></label>}
          {modo === "piatti" && <ul className="space-y-1 text-sm">{nonPagate.map((r) => (
            <li key={r.id}><label className="flex items-center gap-2"><input type="checkbox" checked={scelte.includes(r.id)} className="size-4"
              onChange={() => setScelte((x) => x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id])} />{r.quantita}× {r.nome}<span className="num ml-auto">{euro(r.totale)}</span></label></li>))}</ul>}
          {modo === "importo" && <input inputMode="decimal" placeholder="0,00" value={libero} onChange={(e) => setLibero(e.target.value)} className="input num" aria-label={t.importo} />}
          {mance && <div><p className="mb-1 text-sm">{t.mancia}</p><div className="grid grid-cols-4 gap-1.5 text-sm">{[0, 5, 10, 15].map((p) => (
            <button key={p} onClick={() => setManciaPct(p)} className={cn("rounded-md border py-1.5", manciaPct === p ? "border-fg bg-fg text-bg" : "border-line")}>{p ? `${p}%` : t.nessuna}</button>))}</div></div>}
          <button disabled={inCorso || importo <= 0} className="btn btn-primary h-11 w-full" onClick={() => avvia(async () => {
            const r = await paga(token, importo, mancia, { modo, parti: modo === "uguale" ? parti : undefined, righe: modo === "piatti" ? scelte : undefined });
            setEsito(r.ok ? { ok: true, testo: t.grazie } : { ok: false, testo: r.errore }); if (r.ok) { setScelte([]); onFatto(); }
          })}>{t.paga} {euro(importo + mancia)}</button>
          {prova && <p className="text-xs text-muted">{t.prova}</p>}
          {esito && <p role="status" className={cn("text-sm", esito.ok ? "text-ok" : "text-danger")}>{esito.testo}</p>}
        </section>
      ) : esito && <p role="status" className="mt-4 text-sm text-ok">{esito.testo}</p>}
    </main>
  );
}
