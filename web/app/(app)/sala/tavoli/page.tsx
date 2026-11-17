import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { statoProvider } from "@/lib/sala/pagamenti";
import { cassaCollegata } from "@/lib/sala/cassa";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { Stampa } from "@/components/stampa";
import { CartoncinoQR } from "./qr";

export const metadata: Metadata = { title: "Tavoli e QR" };

type Tav = { id: string; codice: string; posti: number | null; attivo: boolean; qr_token: string; sala: string | null };
type Imp = { lingue: string[]; coperto: number | null; ordini_cliente: boolean; mance: boolean; pagamento_provider: string | null; pagamento_modalita: string; cassa_provider: string | null };

export default async function Tavoli() {
  const { supabase, attivo, piano, inclusa, scrivibile, ruolo } = await sessioneModulo("sala");
  const gestisce = scrivibile && (ruolo === "titolare" || ruolo === "chef");
  const [{ data: tavoli }, { data: imp }] = await Promise.all([
    supabase.from("v_tavoli").select("id,codice,posti,attivo,qr_token,sala").eq("ristorante_id", attivo.id).order("sala").order("codice").returns<Tav[]>(),
    supabase.from("sala_impostazioni").select("*").eq("ristorante_id", attivo.id).maybeSingle<Imp>(),
  ]);
  const provider = imp?.pagamento_provider as "stripe" | "nexi" | "sumup" | "satispay" | null;
  const sp = provider ? statoProvider(provider) : null;

  return (
    <>
      <Intestazione titolo="Tavoli e QR" sottotitolo={attivo.nome}>{(tavoli ?? []).length > 0 && <Stampa etichetta="Stampa i QR" />}</Intestazione>
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Sala" />
      <div className="print:hidden">
        <section className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className="card p-4 text-[13px]">
            <h2 className="font-medium">Pagamento dal tavolo</h2>
            <p className="mt-1"><Badge tono="warn">Modalità di prova</Badge> {provider ? `Servizio scelto: ${provider}` : "Nessun servizio scelto"}</p>
            <p className="mt-2 text-xs text-muted">I clienti possono provare tutto il percorso (dividere il conto, mancia, pagare) ma nessun importo viene addebitato. Per gli incassi reali serve un contratto con un servizio di pagamento (Stripe, Nexi, SumUp, Satispay) intestato al ristorante; le credenziali si inseriscono sul server, non nell&apos;app.</p>
            {sp && <p className="mt-1 text-xs text-muted">Credenziali sul server: {sp.configurato ? "presenti" : `mancanti (${sp.mancanti.join(", ")})`} · adattatore: {sp.implementato ? "pronto" : "da realizzare"}</p>}
          </div>
          <div className="card p-4 text-[13px]">
            <h2 className="font-medium">Cassa fiscale (scontrino)</h2>
            <p className="mt-1">{cassaCollegata() ? <Badge tono="ok">Collegata</Badge> : <Badge tono="warn">Non collegata</Badge>}</p>
            <p className="mt-2 text-xs text-muted">Ogni incasso, anche dal telefono del cliente, deve diventare uno scontrino del registratore telematico. Finché la cassa non è collegata, la sala lo batte sulla cassa e ne annota il numero nel tavolo: l&apos;app tiene il conto degli scontrini ancora da emettere.</p>
          </div>
        </section>
        {ruolo === "titolare" && scrivibile && <div className="mb-4"><Espandi titolo="Impostazioni della sala" aperto={!imp}>
          <Modulo rpc="imposta_sala" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Salva" fatto="Impostazioni salvate"
            datiFissi={{ lingue: imp?.lingue ?? ["it", "en", "fr", "de"] }} campi={[
              { nome: "coperto", etichetta: "Coperto per persona (€)", tipo: "numero", iniziale: imp?.coperto?.toString() ?? "" },
              { nome: "pagamento_provider", etichetta: "Servizio di pagamento previsto", tipo: "select", iniziale: imp?.pagamento_provider ?? "", opzioni: ["stripe", "nexi", "sumup", "satispay"].map((p) => ({ valore: p, etichetta: p })) },
              { nome: "ordini_cliente", etichetta: "Il cliente può ordinare da solo", tipo: "check", iniziale: imp?.ordini_cliente ?? true },
              { nome: "mance", etichetta: "Mostra la mancia al pagamento", tipo: "check", iniziale: imp?.mance ?? true }]} />
          <p className="mt-2 text-[11px] text-subtle">Lingue del menu attive: {(imp?.lingue ?? ["it", "en", "fr", "de"]).join(", ")}. Il cliente sceglie la lingua; dove manca una traduzione vede l&apos;italiano.</p>
        </Espandi></div>}
        {gestisce && <div className="mb-4"><Espandi titolo="Aggiungi un tavolo" aperto={!tavoli?.length}>
          <Modulo rpc="salva_tavolo" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Aggiungi" fatto="Tavolo aggiunto" campi={[
            { nome: "codice", etichetta: "Numero o nome", richiesto: true }, { nome: "posti", etichetta: "Posti", tipo: "numero" }, { nome: "sala", etichetta: "Sala", segnaposto: "es. Sala principale, Dehors" }]} />
        </Espandi></div>}
        {(tavoli ?? []).length > 0 && <ul className="card mb-4 divide-y divide-line text-[13px]">{tavoli!.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 p-3"><span className="font-medium">Tavolo {t.codice}</span><span className="text-xs text-muted">{t.sala ?? "—"} · {t.posti ?? "?"} posti</span>
            {!t.attivo && <Badge>Disattivato</Badge>}
            {gestisce && <span className="ml-auto flex gap-2">
              <Azione rpc="rigenera_qr" parametri={{ p_tavolo_id: t.id }} etichetta="Nuovo QR" conferma="Il QR attuale smetterà di funzionare: dovrai stampare e sostituire il cartoncino. Continuare?" />
              <Azione rpc="salva_tavolo" parametri={{ p_ristorante_id: "@sede", p_tavolo_id: t.id, p_dati: { attivo: !t.attivo } }} etichetta={t.attivo ? "Disattiva" : "Riattiva"} /></span>}
          </li>))}</ul>}
      </div>
      {(tavoli ?? []).length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">{tavoli!.filter((t) => t.attivo).map((t) => (
        <CartoncinoQR key={t.id} codice={t.codice} token={t.qr_token} sede={attivo.nome} />))}</div>
        : <Vuoto titolo="Nessun tavolo">Aggiungi i tavoli: per ognuno viene creato un QR da stampare.</Vuoto>}
      <p className="mt-3 text-[11px] text-subtle print:hidden">Il QR funziona solo quando il tavolo è aperto dalla sala e smette di funzionare alla chiusura: una foto del QR non permette di ordinare da casa.</p>
    </>
  );
}
