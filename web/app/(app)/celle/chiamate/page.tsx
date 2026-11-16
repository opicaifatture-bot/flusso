import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { sessioneModulo } from "@/lib/sessione";
import { dataOra } from "@/lib/format";
import { twilioConfigurato } from "@/lib/twilio";
import { Badge, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";

export const metadata: Metadata = { title: "Chiamate d'allarme" };

type Contatto = { id: string; nome: string; telefono: string; ordine: number; attivo: boolean };
type Impostazioni = { attive: boolean; solo_critici: boolean; attesa_min: number; giri: number; sms_riserva: boolean };
type Chiamata = { id: string; allarme_id: string; nome: string; telefono: string; giro: number; canale: string; stato: string; errore: string | null; creato_il: string };

const STATI: Record<string, { testo: string; tono: "ok" | "warn" | "danger" | "neutro" }> = {
  in_coda: { testo: "In partenza", tono: "neutro" }, inviata: { testo: "Partita", tono: "neutro" }, confermata: { testo: "Confermata (tasto 1)", tono: "ok" },
  senza_risposta: { testo: "Nessuna conferma", tono: "warn" }, errore: { testo: "Errore", tono: "danger" }, non_configurato: { testo: "Non partita: servizio non collegato", tono: "warn" },
};
const nascondi = (t: string) => t.slice(0, -7).replace(/\d/g, "•") + t.slice(-7, -4) + "•" + t.slice(-3);

/** Chi chiamare quando un frigo o una cella va in allarme, e lo storico delle chiamate. */
export default async function ChiamateAllarme() {
  const { supabase, attivo, piano, inclusa, scrivibile, operativo } = await sessioneModulo("celle");
  const [{ data: contatti }, { data: imp }, { data: chiamate }] = await Promise.all([
    supabase.from("contatti_allarme").select("id,nome,telefono,ordine,attivo").eq("ristorante_id", attivo.id).order("ordine").returns<Contatto[]>(),
    supabase.from("impostazioni_chiamate").select("attive,solo_critici,attesa_min,giri,sms_riserva").eq("ristorante_id", attivo.id).maybeSingle<Impostazioni>(),
    supabase.from("chiamate_allarme").select("id,allarme_id,nome,telefono,giro,canale,stato,errore,creato_il").eq("ristorante_id", attivo.id).order("creato_il", { ascending: false }).limit(50).returns<Chiamata[]>(),
  ]);
  const collegato = twilioConfigurato();
  const i = imp ?? { attive: false, solo_critici: false, attesa_min: 5, giri: 2, sms_riserva: true };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/celle" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna alle celle"><ArrowLeft className="size-4" /></Link>
        <div><h1 className="text-lg font-semibold tracking-tight">Chiamate d&apos;allarme</h1>
          <p className="text-xs text-muted">{attivo.nome} · quando una cella resta fuori temperatura, il telefono squilla</p></div>
      </div>
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Celle e temperature" />

      <div className={`card mb-4 p-4 text-[13px] ${collegato ? "" : "border-warn/40 bg-warn-soft"}`}>
        {collegato
          ? <p><Badge tono="ok">Servizio telefonico collegato</Badge> <span className="ml-2 text-muted">Le chiamate partono tramite Twilio.</span></p>
          : <p><Badge tono="warn">Servizio telefonico non collegato</Badge> <span className="ml-2">Le chiavi Twilio non sono ancora impostate: gli allarmi restano visibili nell&apos;app ma <strong>nessuna telefonata parte</strong>. Lo storico qui sotto lo indica chiaramente.</span></p>}
        <p className="mt-2 text-xs text-muted">Come funziona: all&apos;apertura di un allarme viene chiamato il primo numero. Chi risponde preme 1 per prendersi l&apos;allarme. Senza conferma, dopo l&apos;attesa impostata si chiama il numero successivo; finiti i giri parte un SMS a tutti. Le chiamate si fermano quando qualcuno conferma o l&apos;allarme viene preso in carico o chiuso nell&apos;app. Funziona solo con letture che arrivano davvero: di notte servono i sensori collegati.</p>
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-[13px] font-medium">Numeri da chiamare, in ordine</h2>
        {contatti?.length ? (
          <ul className="card divide-y divide-line">
            {contatti.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                <span className="num w-6 text-subtle">{c.ordine}.</span>
                <span className="flex-1 font-medium">{c.nome} <span className="num ml-2 font-normal text-muted">{c.telefono}</span>{!c.attivo && <Badge className="ml-2">sospeso</Badge>}</span>
                {operativo && <>
                  <Azione rpc="salva_contatto_allarme" parametri={{ p_ristorante_id: attivo.id, p_id: c.id, p_nome: c.nome, p_telefono: c.telefono, p_ordine: c.ordine, p_attivo: !c.attivo }} etichetta={c.attivo ? "Sospendi" : "Riattiva"} />
                  <Azione rpc="elimina_contatto_allarme" parametri={{ p_ristorante_id: attivo.id, p_id: c.id }} etichetta="Rimuovi" conferma={`Rimuovere ${c.nome} dai numeri d'allarme?`} />
                </>}
              </li>))}
          </ul>
        ) : <div className="card"><Vuoto compatto titolo="Nessun numero">Aggiungi il responsabile e almeno una riserva.</Vuoto></div>}
        {operativo && <div className="mt-2"><Espandi titolo="Aggiungi un numero">
          <Modulo rpc="salva_contatto_allarme" fissi={{ p_ristorante_id: "@sede", p_id: null, p_attivo: true }} invio="Aggiungi" fatto="Numero aggiunto" campi={[
            { nome: "p_nome", etichetta: "Nome", richiesto: true, segnaposto: "es. Responsabile cucina" },
            { nome: "p_telefono", etichetta: "Cellulare", richiesto: true, segnaposto: "+39 333 1234567", aiuto: "Senza prefisso si assume un cellulare italiano." },
            { nome: "p_ordine", etichetta: "Ordine di chiamata", tipo: "numero", iniziale: String((contatti?.length ?? 0) + 1) },
          ]} />
        </Espandi></div>}
      </section>

      {operativo && <section className="mb-4"><Espandi titolo={`Regole di chiamata · ${i.attive ? "attive" : "spente"}`} aperto={!i.attive}>
        <Modulo rpc="imposta_chiamate" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Salva regole" campi={[
          { nome: "attive", etichetta: "Chiamate d'allarme attive", tipo: "check", iniziale: i.attive },
          { nome: "solo_critici", etichetta: "Chiama solo quando l'allarme diventa critico", tipo: "check", iniziale: i.solo_critici, aiuto: "\"Critico dopo\" si imposta su ogni cella." },
          { nome: "attesa_min", etichetta: "Minuti di attesa prima del numero successivo", tipo: "numero", iniziale: String(i.attesa_min) },
          { nome: "giri", etichetta: "Giri di chiamate su tutti i numeri", tipo: "numero", iniziale: String(i.giri) },
          { nome: "sms_riserva", etichetta: "Finiti i giri, manda un SMS a tutti", tipo: "check", iniziale: i.sms_riserva },
        ]} />
      </Espandi></section>}

      <section>
        <h2 className="mb-2 text-[13px] font-medium">Storico chiamate</h2>
        <div className="card overflow-x-auto">
          {chiamate?.length ? <table className="w-full min-w-[600px] text-[13px]">
            <thead><tr><th scope="col" className="th">Quando</th><th scope="col" className="th">A chi</th><th scope="col" className="th">Tipo</th><th scope="col" className="th">Esito</th></tr></thead>
            <tbody>{chiamate.map((k) => { const s = STATI[k.stato] ?? STATI.in_coda; return (
              <tr key={k.id} className="riga">
                <td className="td num text-muted">{dataOra(k.creato_il)}</td>
                <td className="td">{k.nome} <span className="num text-xs text-subtle">{nascondi(k.telefono)}</span></td>
                <td className="td">{k.canale === "sms" ? "SMS" : `Chiamata · giro ${k.giro}`}</td>
                <td className="td"><Badge tono={s.tono}>{s.testo}</Badge>{k.errore && <span className="block text-xs text-subtle">{k.errore}</span>}</td>
              </tr>); })}</tbody>
          </table> : <Vuoto compatto titolo="Nessuna chiamata finora" />}
        </div>
      </section>
    </div>
  );
}
