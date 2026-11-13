import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { cn, dataOra, money } from "@/lib/format";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { TempoReale } from "./tempo-reale";
import { OrdineSala } from "./ordine-sala";

export const metadata: Metadata = { title: "Servizio di sala" };
export const dynamic = "force-dynamic";

type Tavolo = { id: string; codice: string; posti: number | null; attivo: boolean; sala: string | null; sala_ordine: number | null; sessione_id: string | null; sessione_stato: string | null;
  coperti: number | null; aperta_il: string | null; chiamate_aperte: number; righe_pronte: number; righe_in_corso: number };
type Chiamata = { id: string; tipo: string; stato: string; creata_il: string; sessione_id: string };
type Riga = { id: string; nome: string; quantita: number; prezzo: number; note: string | null; uscita: number; stato: string; reparto: string; motivo_annullamento: string | null; ordini_tavolo: { numero: number; fonte: string } | null };
type Pag = { id: string; importo: number; mancia: number; metodo: string; provider: string; stato: string; fiscale_stato: string; fiscale_rif: string | null; creato_il: string };
type Conto = { totale: number; pagato: number; da_pagare: number; coperto: number; mance: number };
const TIPI: Record<string, string> = { cameriere: "Chiama il cameriere", conto: "Chiede il conto", acqua: "Acqua", pane: "Pane" };
const STATI: Record<string, { e: string; t: "neutro" | "warn" | "ok" | "info" | "danger" }> = {
  inviato: { e: "Inviato", t: "info" }, in_preparazione: { e: "In preparazione", t: "warn" }, pronto: { e: "Pronto", t: "ok" }, servito: { e: "Servito", t: "neutro" }, annullato: { e: "Annullato", t: "danger" },
};

export default async function Servizio({ searchParams }: { searchParams: Promise<{ tavolo?: string }> }) {
  const { tavolo: scelto } = await searchParams;
  const { supabase, attivo, piano, inclusa, scrivibile, ruolo } = await sessioneModulo("sala");
  const [{ data: tavoli }, { data: chiamate }, { data: voci }] = await Promise.all([
    supabase.from("v_tavoli").select("*").eq("ristorante_id", attivo.id).eq("attivo", true).order("sala_ordine").order("codice").returns<Tavolo[]>(),
    supabase.from("chiamate_tavolo").select("id,tipo,stato,creata_il,sessione_id").eq("ristorante_id", attivo.id).neq("stato", "chiusa").order("creata_il").returns<Chiamata[]>(),
    supabase.from("menu_voci").select("id,nome,categoria,esaurito").eq("ristorante_id", attivo.id).eq("visibile", true).order("categoria").order("ordine").returns<{ id: string; nome: string; categoria: string; esaurito: boolean }[]>(),
  ]);
  const opera = scrivibile && ruolo !== "sola_lettura";
  const perSessione = new Map((tavoli ?? []).filter((t) => t.sessione_id).map((t) => [t.sessione_id!, t]));
  const t = (tavoli ?? []).find((x) => x.id === scelto) ?? null;
  const [{ data: righe }, { data: pagamenti }, { data: conto }] = t?.sessione_id ? await Promise.all([
    supabase.from("ordini_righe").select("id,nome,quantita,prezzo,note,uscita,stato,reparto,motivo_annullamento,ordini_tavolo(numero,fonte)").eq("sessione_id", t.sessione_id).order("uscita").returns<Riga[]>(),
    supabase.from("pagamenti_tavolo").select("id,importo,mancia,metodo,provider,stato,fiscale_stato,fiscale_rif,creato_il").eq("sessione_id", t.sessione_id).order("creato_il").returns<Pag[]>(),
    supabase.rpc("conto_sessione", { p_sessione_id: t.sessione_id }),
  ]) : [{ data: null }, { data: null }, { data: null }];
  const c = conto as Conto | null;
  const sale = [...new Set((tavoli ?? []).map((x) => x.sala ?? "Sala"))];

  return (
    <>
      <Intestazione titolo="Servizio" sottotitolo={attivo.nome}><TempoReale sede={attivo.id} tabelle={["chiamate_tavolo", "ordini_righe", "sessioni_tavolo", "pagamenti_tavolo"]} /></Intestazione>
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Sala" />

      {(chiamate ?? []).length > 0 && (
        <section className="mb-4" aria-labelledby="t-chiamate"><h2 id="t-chiamate" className="eyebrow mb-2">Richieste dai tavoli</h2>
          <ul className="space-y-2">{chiamate!.map((x) => { const tv = perSessione.get(x.sessione_id); return (
            <li key={x.id} className={cn("card flex flex-wrap items-center gap-3 p-3", x.stato === "aperta" && "border-danger")}>
              <span className="text-lg font-semibold">{tv?.codice ?? "?"}</span><span className="text-sm">{TIPI[x.tipo]}</span>
              <span className="text-xs text-muted">{dataOra(x.creata_il)}</span>{x.stato === "presa" && <Badge>In carico</Badge>}
              {opera && <span className="ml-auto flex gap-2">
                {x.stato === "aperta" && <Azione rpc="gestisci_chiamata" parametri={{ p_chiamata_id: x.id, p_azione: "prendi" }} etichetta="Ci penso io" stile="btn btn-sm btn-primary" />}
                <Azione rpc="gestisci_chiamata" parametri={{ p_chiamata_id: x.id, p_azione: "chiudi" }} etichetta="Fatto" /></span>}
            </li>); })}</ul></section>
      )}

      {(tavoli ?? []).length ? sale.map((sa) => (
        <section key={sa} className="mb-4"><h2 className="eyebrow mb-2">{sa}</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">{(tavoli ?? []).filter((x) => (x.sala ?? "Sala") === sa).map((x) => (
            <Link key={x.id} href={`/sala?tavolo=${x.id}`} scroll={false} aria-current={x.id === scelto ? "true" : undefined}
              className={cn("card relative flex aspect-square flex-col items-center justify-center p-2 text-center",
                !x.sessione_id && "opacity-60", x.sessione_stato === "conto_richiesto" && "border-warn", x.chiamate_aperte > 0 && "border-danger", x.id === scelto && "ring-2 ring-fg")}>
              <span className="text-lg font-semibold">{x.codice}</span>
              <span className="text-[11px] text-muted">{x.sessione_id ? `${x.coperti ?? "?"} coperti` : "libero"}</span>
              {x.righe_pronte > 0 && <span className="mt-1 rounded-full bg-ok-soft px-1.5 text-[10px] text-ok">{x.righe_pronte} pronti</span>}
              {x.sessione_stato === "conto_richiesto" && <span className="mt-1 text-[10px] text-warn">conto</span>}
              {x.chiamate_aperte > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 animate-pulse rounded-full bg-danger" />}
            </Link>
          ))}</div></section>
      )) : <Vuoto titolo="Nessun tavolo">Crea i tavoli e stampa i QR in <Link className="underline" href="/sala/tavoli">Tavoli e QR</Link>.</Vuoto>}

      {t && (
        <section className="card p-4" aria-labelledby="t-tavolo">
          <div className="flex flex-wrap items-center gap-2"><h2 id="t-tavolo" className="text-base font-semibold">Tavolo {t.codice}</h2>
            {t.sessione_id ? <Badge tono={t.sessione_stato === "conto_richiesto" ? "warn" : "ok"}>{t.sessione_stato === "conto_richiesto" ? "Conto richiesto" : "Aperto"}</Badge> : <Badge>Libero</Badge>}
            {t.aperta_il && <span className="text-xs text-muted">dalle {dataOra(t.aperta_il)}</span>}</div>
          {!t.sessione_id ? (opera && <div className="mt-3 max-w-xs"><Modulo rpc="apri_tavolo" fissi={{ p_tavolo_id: t.id }} compatto invio="Apri il tavolo" fatto="Tavolo aperto: il QR ora funziona"
              campi={[{ nome: "p_coperti", etichetta: "Coperti", tipo: "numero", iniziale: t.posti?.toString() ?? "" }]} /></div>) : (
            <>
              <ul className="mt-3 divide-y divide-line text-[13px]">{(righe ?? []).map((r) => (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-2 py-2", r.stato === "annullato" && "opacity-50 line-through")}>
                  <span className="num w-8 text-muted">{r.quantita}×</span><span className="min-w-0 flex-1">{r.nome}{r.note && <span className="block text-xs text-warn">{r.note}</span>}
                    <span className="block text-[11px] text-subtle">uscita {r.uscita} · ordine {r.ordini_tavolo?.numero} {r.ordini_tavolo?.fonte === "tavolo" ? "dal cliente" : "dalla sala"}</span></span>
                  <Badge tono={STATI[r.stato]?.t}>{STATI[r.stato]?.e}</Badge>
                  {opera && r.stato === "pronto" && <Azione rpc="avanza_riga" parametri={{ p_riga_id: r.id, p_stato: "servito" }} etichetta="Servito" stile="btn btn-sm btn-primary" />}
                  {opera && !["servito", "annullato"].includes(r.stato) && <Azione rpc="avanza_riga" parametri={{ p_riga_id: r.id, p_stato: "annullato" }} etichetta="Annulla" motivo={{ parametro: "p_motivo", domanda: "Perché annulli questa riga?" }} />}
                </li>
              ))}</ul>
              {c && <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-md bg-raised p-2"><p className="text-xs text-muted">Totale</p><p className="num font-semibold">{money(c.totale)}</p></div>
                <div className="rounded-md bg-raised p-2"><p className="text-xs text-muted">Pagato</p><p className="num font-semibold text-ok">{money(c.pagato)}</p></div>
                <div className="rounded-md bg-raised p-2"><p className="text-xs text-muted">Da pagare</p><p className="num font-semibold">{money(c.da_pagare)}</p></div></div>}
              {(pagamenti ?? []).length > 0 && <ul className="mt-3 space-y-1 text-xs">{pagamenti!.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2"><span className="num">{money(p.importo)}{p.mancia > 0 ? ` + mancia ${money(p.mancia)}` : ""}</span>
                  <Badge>{p.metodo === "online" ? (p.provider === "prova" ? "Online (prova, nessun addebito)" : `Online · ${p.provider}`) : p.metodo === "carta_pos" ? "Carta (POS)" : "Contanti"}</Badge>
                  <Badge tono={p.stato === "pagato" ? "ok" : "warn"}>{p.stato}</Badge>
                  {p.fiscale_stato === "emesso" ? <span className="text-ok">scontrino {p.fiscale_rif}</span> : <span className="text-warn">scontrino da emettere sulla cassa</span>}
                  {opera && p.stato === "pagato" && p.fiscale_stato === "da_emettere" && <Azione rpc="segna_scontrino" parametri={{ p_pagamento_id: p.id }} etichetta="Ho emesso lo scontrino"
                    motivo={{ parametro: "p_riferimento", domanda: "Numero dello scontrino (come stampato dalla cassa)" }} />}
                </li>))}</ul>}
              {opera && <div className="mt-4 space-y-2">
                <Espandi titolo="Aggiungi un ordine"><OrdineSala sessione={t.sessione_id} voci={voci ?? []} /></Espandi>
                {c && c.da_pagare > 0 && <Espandi titolo="Registra un pagamento in sala">
                  <Modulo rpc="registra_pagamento_sala" fissi={{ p_sessione_id: t.sessione_id }} compatto invio="Registra" fatto="Pagamento registrato" campi={[
                    { nome: "p_importo", etichetta: "Importo", tipo: "numero", richiesto: true, iniziale: String(c.da_pagare).replace(".", ",") },
                    { nome: "p_metodo", etichetta: "Metodo", tipo: "select", richiesto: true, iniziale: "carta_pos", opzioni: [{ valore: "carta_pos", etichetta: "Carta (POS)" }, { valore: "contanti", etichetta: "Contanti" }] },
                    { nome: "p_mancia", etichetta: "Mancia", tipo: "numero" }]} /></Espandi>}
                <Espandi titolo="Coperti"><Modulo rpc="imposta_coperti" fissi={{ p_sessione_id: t.sessione_id }} compatto invio="Salva" campi={[{ nome: "p_coperti", etichetta: "Coperti", tipo: "numero", richiesto: true, iniziale: t.coperti?.toString() ?? "" }]} /></Espandi>
                <Azione rpc="chiudi_tavolo" parametri={{ p_sessione_id: t.sessione_id }} etichetta="Chiudi il tavolo" stile="btn btn-sm"
                  conferma={c && c.da_pagare > 0 ? undefined : "Chiudere il tavolo? Il QR smette di funzionare finché non lo riapri."}
                  motivo={c && c.da_pagare > 0 ? { parametro: "p_nota", domanda: `Restano ${money(c.da_pagare)} da pagare. Motivo della chiusura (es. pagato alla cassa, offerto):` } : undefined} />
              </div>}
              <p className="mt-3 text-[11px] leading-relaxed text-subtle">Nessuna cassa fiscale è collegata: per ogni incasso emetti lo scontrino dal registratore telematico e annota il numero qui. Il pagamento online dal tavolo è in modalità di prova finché non colleghiamo un servizio di pagamento.</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
