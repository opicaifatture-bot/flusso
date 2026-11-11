import type { Metadata } from "next";
import Link from "next/link";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data, dataOra, num } from "@/lib/format";
import { REGIONI } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi, Modulo } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { FirmaPolicy } from "./firma";

export const metadata: Metadata = { title: "Formazione del personale" };

type Regola = { id: string; gruppo_id: string | null; regione: string; codice: string; nome: string; destinatari: string | null; ore_minime: number | null; validita_anni: number | null;
  aggiornamento_ore: number | null; requisiti_docente: string | null; argomenti: string | null; atto: string | null; fonte: string | null; stato: string; nota: string | null; verificata_il: string | null };
type Formazione = { id: string; persona_id: string; tipo: string; titolo: string; ente: string | null; ore: number | null; data: string; scadenza: string | null; regola_id: string | null };
type Firma = { persona_id: string; firmata_il: string; valida_fino: string };
const TIPI_F = { corso: "Corso", aggiornamento: "Aggiornamento", addestramento_interno: "Addestramento interno" } as Record<string, string>;

export default async function Formazione() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, persone, puoGestire, puoPianificare, puoRegistrare, oggi } = c;
  const [{ data: sede }, { data: regole }, { data: formazioni }, { data: attestati }, { data: policy }, { data: firme }] = await Promise.all([
    supabase.from("ristoranti").select("regione").eq("id", attivo.id).single<{ regione: string | null }>(),
    supabase.from("regole_formazione").select("*").order("regione").order("codice").returns<Regola[]>(),
    supabase.from("formazioni").select("id,persona_id,tipo,titolo,ente,ore,data,scadenza,regola_id").eq("ristorante_id", attivo.id).order("data", { ascending: false }).returns<Formazione[]>(),
    supabase.from("archivio").select("id,titolo").eq("ristorante_id", attivo.id).eq("categoria", "attestato_formazione").eq("archiviato", false).returns<{ id: string; titolo: string }[]>(),
    supabase.from("archivio").select("id,titolo,archivio_versioni(id,versione,file_path)").eq("ristorante_id", attivo.id).eq("categoria", "policy_igiene").eq("archiviato", false)
      .order("creato_il", { ascending: false }).limit(1).maybeSingle<{ id: string; titolo: string; archivio_versioni: { id: string; versione: number; file_path: string }[] }>(),
    supabase.from("firme_policy").select("persona_id,firmata_il,valida_fino").eq("ristorante_id", attivo.id).order("firmata_il", { ascending: false }).returns<Firma[]>(),
  ]);
  const regione = sede?.regione ?? null;
  const delGruppo = (regole ?? []).filter((r) => r.gruppo_id);
  const diRiferimento = (regole ?? []).filter((r) => !r.gruppo_id && r.regione === regione);
  const altreRegioni = [...new Set((regole ?? []).filter((r) => !r.gruppo_id).map((r) => r.regione))];
  const opRegole = [...delGruppo, ...diRiferimento].map((r) => ({ valore: r.id, etichetta: `${r.regione} · ${r.nome}${r.stato === "verificata" ? "" : " (da verificare)"}` }));
  const versionePolicy = policy ? [...policy.archivio_versioni].sort((a, b) => b.versione - a.versione)[0] : null;
  const ultimaFirma = new Map<string, Firma>(); for (const f of firme ?? []) if (!ultimaFirma.has(f.persona_id)) ultimaFirma.set(f.persona_id, f);

  const scheda = (r: Regola) => (
    <li key={r.id} className="p-4 text-[13px]">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.nome}</span><span className="text-xs text-subtle">{r.regione} · {r.codice}</span>
        {r.stato === "verificata" ? <Badge tono="ok">Verificata il {data(r.verificata_il)}</Badge> : <Badge tono="warn">Da verificare</Badge>}</div>
      <p className="mt-1 text-xs text-muted">{[r.destinatari, r.ore_minime != null && `${num(r.ore_minime, 0)} ore minime`, r.validita_anni != null && `validità ${r.validita_anni} anni`,
        r.aggiornamento_ore != null && `aggiornamento ${num(r.aggiornamento_ore, 0)} ore`].filter(Boolean).join(" · ")}</p>
      {r.requisiti_docente && <p className="mt-1 text-xs text-muted">Requisiti del docente: {r.requisiti_docente}</p>}
      {r.argomenti && <p className="mt-1 text-xs text-muted">Argomenti: {r.argomenti}</p>}
      <p className="mt-1 text-[11px] text-subtle">Atto: {r.atto ?? "non indicato"}{r.fonte ? ` · fonte: ${r.fonte}` : ""}{r.nota ? ` · ${r.nota}` : ""}</p>
      {puoPianificare && !r.gruppo_id && <div className="mt-2"><Espandi titolo="Conferma con il testo dell'atto">
        <Modulo rpc="salva_regola_formazione" fissi={{ p_gruppo_id: "@gruppo", p_da_regola: r.id }} inDati="p_dati" invio="Salva come verificata" datiFissi={{ verificata: true }} campi={[
          { nome: "atto", etichetta: "Atto (numero e data)", richiesto: true, iniziale: r.atto ?? "" }, { nome: "ore_minime", etichetta: "Ore minime", tipo: "numero", iniziale: r.ore_minime?.toString() ?? "" },
          { nome: "validita_anni", etichetta: "Validità (anni)", tipo: "numero", iniziale: r.validita_anni?.toString() ?? "" }, { nome: "aggiornamento_ore", etichetta: "Ore di aggiornamento", tipo: "numero", iniziale: r.aggiornamento_ore?.toString() ?? "" },
          { nome: "requisiti_docente", etichetta: "Requisiti del docente", tipo: "area", largo: true }, { nome: "argomenti", etichetta: "Argomenti obbligatori", tipo: "area", largo: true },
          { nome: "fonte", etichetta: "Dove l'hai verificato", iniziale: "", largo: true }]} />
      </Espandi></div>}
    </li>
  );

  return (
    <>
      <Intestazione titolo="Formazione del personale" sottotitolo={attivo.nome} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="formazione" />

      <section className="card mb-4 p-4">
        <p className="text-[13px]">Regione della sede: <strong>{regione ?? "non indicata"}</strong></p>
        {puoPianificare && <div className="mt-2 max-w-md"><Modulo rpc="imposta_sede_autocontrollo" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" compatto invio="Salva" campi={[
          { nome: "regione", etichetta: "Regione", tipo: "select", richiesto: true, iniziale: regione ?? "", opzioni: REGIONI.map((r) => ({ valore: r, etichetta: r })) }]} /></div>}
        <p className="mt-2 text-[11px] leading-relaxed text-subtle">La formazione degli alimentaristi è regolata da ogni Regione. Le regole precaricate vengono da fonti secondarie e sono marcate «da verificare»: non calcolano scadenze finché il titolare o il consulente non le conferma con il testo dell&apos;atto. Regioni con un riferimento precaricato: {altreRegioni.join(", ")}.</p>
      </section>

      <section className="mb-4" aria-labelledby="t-regole">
        <h2 id="t-regole" className="eyebrow mb-2">Regole di formazione</h2>
        {delGruppo.length + diRiferimento.length ? <ul className="card divide-y divide-line">{[...delGruppo, ...diRiferimento].map(scheda)}</ul>
          : <Vuoto compatto titolo={regione ? `Nessun riferimento precaricato per ${regione}` : "Indica la regione della sede"}>Puoi inserire la regola a mano dal testo dell&apos;atto.</Vuoto>}
        {puoPianificare && <div className="mt-2"><Espandi titolo="Aggiungi una regola dal testo dell'atto">
          <Modulo rpc="salva_regola_formazione" fissi={{ p_gruppo_id: "@gruppo" }} inDati="p_dati" invio="Aggiungi" campi={[
            { nome: "regione", etichetta: "Regione", tipo: "select", richiesto: true, iniziale: regione ?? "", opzioni: REGIONI.map((r) => ({ valore: r, etichetta: r })) },
            { nome: "nome", etichetta: "Nome del modulo", richiesto: true }, { nome: "codice", etichetta: "Codice" }, { nome: "destinatari", etichetta: "Destinatari" },
            { nome: "ore_minime", etichetta: "Ore minime", tipo: "numero" }, { nome: "validita_anni", etichetta: "Validità (anni)", tipo: "numero" },
            { nome: "aggiornamento_ore", etichetta: "Ore di aggiornamento", tipo: "numero" }, { nome: "atto", etichetta: "Atto", richiesto: true },
            { nome: "requisiti_docente", etichetta: "Requisiti del docente", tipo: "area", largo: true }, { nome: "argomenti", etichetta: "Argomenti", tipo: "area", largo: true },
            { nome: "verificata", etichetta: "Verificata sul testo ufficiale", tipo: "check" }]} />
        </Espandi></div>}
      </section>

      <section className="mb-4" aria-labelledby="t-pers">
        <h2 id="t-pers" className="eyebrow mb-2">Persone</h2>
        {persone.length ? <ul className="card divide-y divide-line">{persone.map((p) => {
          const corsi = (formazioni ?? []).filter((f) => f.persona_id === p.id); const firma = ultimaFirma.get(p.id);
          return (
            <li key={p.id} className="p-4 text-[13px]">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.nome}</span>
                {versionePolicy && (firma && firma.valida_fino >= oggi ? <Badge tono="ok">Policy firmata il {dataOra(firma.firmata_il)}</Badge> : <Badge tono="danger">Policy da firmare</Badge>)}</div>
              {corsi.length ? <ul className="mt-1 space-y-0.5 text-xs text-muted">{corsi.map((f) => (
                <li key={f.id}>{TIPI_F[f.tipo]} · {f.titolo} · {data(f.data)}{f.ore ? ` · ${num(f.ore, 0)} ore` : ""}{f.ente ? ` · ${f.ente}` : ""}
                  {f.scadenza ? <> · <span className={f.scadenza < oggi ? "text-danger" : ""}>scade il {data(f.scadenza)}</span></> : <span className="text-subtle"> · scadenza non calcolata</span>}</li>
              ))}</ul> : <p className="mt-1 text-xs text-warn">Nessuna formazione registrata</p>}
              {puoGestire && <div className="mt-2"><Espandi titolo="Registra un corso o un addestramento">
                <Modulo rpc="registra_formazione" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" datiFissi={{ persona_id: p.id }} invio="Registra" campi={[
                  { nome: "tipo", etichetta: "Tipo", tipo: "select", richiesto: true, iniziale: "corso", opzioni: Object.entries(TIPI_F).map(([valore, etichetta]) => ({ valore, etichetta })) },
                  { nome: "regola_id", etichetta: "Modulo regionale", tipo: "select", opzioni: opRegole }, { nome: "titolo", etichetta: "Titolo (se diverso)" },
                  { nome: "data", etichetta: "Data", tipo: "data", richiesto: true }, { nome: "ore", etichetta: "Ore", tipo: "numero" }, { nome: "ente", etichetta: "Ente formatore" },
                  { nome: "docente", etichetta: "Docente" }, { nome: "scadenza", etichetta: "Scadenza (se indicata sull'attestato)", tipo: "data" },
                  { nome: "archivio_id", etichetta: "Attestato (da Documenti)", tipo: "select", opzioni: (attestati ?? []).map((a) => ({ valore: a.id, etichetta: a.titolo })) }]} />
              </Espandi></div>}
            </li>
          );
        })}</ul> : <Vuoto compatto titolo="Nessuna persona"><Link className="underline" href="/autocontrollo/persone">Aggiungi il personale</Link>.</Vuoto>}
      </section>

      <section className="card p-4" aria-labelledby="t-policy">
        <h2 id="t-policy" className="text-[13px] font-medium">Addestramento interno: firma annuale della policy di igiene</h2>
        {versionePolicy ? (
          <>
            <p className="mt-1 text-xs text-muted">Documento in vigore: <a className="underline" target="_blank" rel="noopener" href={`/autocontrollo/documenti/file?p=${encodeURIComponent(versionePolicy.file_path)}`}>{policy?.titolo} v{versionePolicy.versione}</a>. Ogni persona la firma una volta l&apos;anno.</p>
            {puoRegistrare && persone.length > 0 && <div className="mt-3"><FirmaPolicy versione={versionePolicy.id} persone={persone} /></div>}
          </>
        ) : <p className="mt-1 text-xs text-warn">Carica la policy di igiene in Documenti (tipo «Policy di igiene interna») per raccogliere le firme.</p>}
      </section>
    </>
  );
}
