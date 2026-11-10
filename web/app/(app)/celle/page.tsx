import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { cn, dataOra, num } from "@/lib/format";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { InDiretta } from "@/components/in-diretta";

export const metadata: Metadata = { title: "Celle e temperature" };

type Ubicazione = {
  id: string; nome: string; tipo: string; posizione: string | null; capacita: string | null; monitorata: boolean;
  temp_min: number | null; temp_max: number | null; allarme_dopo_min: number; isteresi: number; critico_dopo_min: number | null;
  silenzio_dopo_min: number | null; ultima_temperatura: number | null; ultima_lettura_il: string | null; ultima_fonte: string | null;
  allarmi_aperti: number; n_sensori: number; stato_temperatura: string;
};
type Allarme = { id: string; ubicazione_id: string; tipo: string; severita: string; stato: string; aperto_il: string; inizio_il: string | null; valore_estremo: number | null; dettaglio: string | null; note: string | null; risolto_il: string | null; risolto_auto: boolean };
type Lettura = { id: number; valore: number; rilevata_il: string; fonte: string; qualita: string; nota: string | null };
type Sensore = { id: string; nome: string; identificativo_esterno: string | null; stato: string; ultima_lettura_il: string | null; ultima_calibrazione: string | null };

// Lo stato dice sempre da dove viene: una cella senza dati recenti non è mai "in regola".
const STATI: Record<string, { testo: string; tono: "ok" | "warn" | "danger" | "neutro" }> = {
  ok: { testo: "In intervallo", tono: "ok" }, allarme: { testo: "In allarme", tono: "danger" },
  fuori_intervallo: { testo: "Fuori intervallo", tono: "warn" }, dati_mancanti: { testo: "Dati mancanti", tono: "danger" },
  nessun_dato: { testo: "Nessuna lettura", tono: "warn" }, non_monitorata: { testo: "Non monitorata", tono: "neutro" },
};
const TIPI_ALLARME: Record<string, string> = { temperatura_alta: "Temperatura alta", temperatura_bassa: "Temperatura bassa", dati_mancanti: "Dati mancanti", fuori_scala: "Sensore fuori scala" };
const TIPI = [{ valore: "cella", etichetta: "Cella" }, { valore: "frigorifero", etichetta: "Frigorifero" }, { valore: "congelatore", etichetta: "Congelatore" }];
const intervallo = (u: Ubicazione) => u.temp_min != null && u.temp_max != null ? `${num(u.temp_min, 1)} … ${num(u.temp_max, 1)} °C` : u.temp_max != null ? `fino a ${num(u.temp_max, 1)} °C` : u.temp_min != null ? `da ${num(u.temp_min, 1)} °C` : "soglie non impostate";

export default async function Celle({ searchParams }: { searchParams: Promise<{ cella?: string }> }) {
  const { cella } = await searchParams;
  const { supabase, attivo, piano, inclusa, scrivibile, operativo, titolare } = await sessioneModulo("celle");
  const [{ data: ubicazioni }, { data: allarmi }] = await Promise.all([
    supabase.from("v_ubicazioni").select("*").eq("ristorante_id", attivo.id).in("tipo", ["cella", "frigorifero", "congelatore"]).eq("attiva", true).order("nome").returns<Ubicazione[]>(),
    supabase.from("allarmi").select("*").eq("ristorante_id", attivo.id).order("aperto_il", { ascending: false }).limit(40).returns<Allarme[]>(),
  ]);
  const celle = ubicazioni ?? [];
  const scelta = celle.find((u) => u.id === cella);
  const [{ data: letture }, { data: sensori }] = scelta ? await Promise.all([
    supabase.from("letture").select("id,valore,rilevata_il,fonte,qualita,nota").eq("ubicazione_id", scelta.id).order("rilevata_il", { ascending: false }).limit(30).returns<Lettura[]>(),
    supabase.from("sensori").select("id,nome,identificativo_esterno,stato,ultima_lettura_il,ultima_calibrazione").eq("ubicazione_id", scelta.id).order("creato_il").returns<Sensore[]>(),
  ]) : [{ data: [] as Lettura[] }, { data: [] as Sensore[] }];
  const aperti = (allarmi ?? []).filter((a) => a.stato !== "risolto");
  const nome = (id: string) => celle.find((u) => u.id === id)?.nome ?? "—";
  const campiSoglie = (u?: Ubicazione) => [
    { nome: "nome", etichetta: "Nome", richiesto: true, iniziale: u?.nome },
    { nome: "tipo", etichetta: "Tipo", tipo: "select" as const, opzioni: TIPI, richiesto: true, iniziale: u?.tipo },
    { nome: "posizione", etichetta: "Posizione", iniziale: u?.posizione ?? "" },
    { nome: "capacita", etichetta: "Capacità", iniziale: u?.capacita ?? "", segnaposto: "es. 12 m³" },
    { nome: "temp_min", etichetta: "Temperatura minima (°C)", tipo: "numero" as const, iniziale: u?.temp_min != null ? String(u.temp_min) : "" },
    { nome: "temp_max", etichetta: "Temperatura massima (°C)", tipo: "numero" as const, iniziale: u?.temp_max != null ? String(u.temp_max) : "", aiuto: "Dal tuo piano HACCP: l'app non propone valori." },
    { nome: "allarme_dopo_min", etichetta: "Allarme dopo (minuti fuori intervallo)", tipo: "numero" as const, iniziale: String(u?.allarme_dopo_min ?? 0) },
    { nome: "isteresi", etichetta: "Rientro richiesto per chiudere (°C)", tipo: "numero" as const, iniziale: String(u?.isteresi ?? 0) },
    { nome: "critico_dopo_min", etichetta: "Diventa critico dopo (minuti)", tipo: "numero" as const, iniziale: u?.critico_dopo_min != null ? String(u.critico_dopo_min) : "" },
    { nome: "silenzio_dopo_min", etichetta: "Segnala dati mancanti dopo (minuti)", tipo: "numero" as const, iniziale: u?.silenzio_dopo_min != null ? String(u.silenzio_dopo_min) : "" },
    { nome: "monitorata", etichetta: "Monitoraggio e allarmi attivi", tipo: "check" as const, iniziale: u?.monitorata ?? false },
  ];

  return (
    <>
      <InDiretta ristoranteId={attivo.id} inLavorazione={aperti.length > 0} />
      <Intestazione titolo="Celle e temperature" sottotitolo={<>{attivo.nome} · temperature in °C · orari Europe/Rome</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Celle e temperature" />

      {aperti.length > 0 && (
        <section aria-labelledby="t-all" className="mb-4">
          <h2 id="t-all" className="mb-2 text-[13px] font-medium">Allarmi aperti <span className="num text-subtle">· {aperti.length}</span></h2>
          <ul className="space-y-2">
            {aperti.map((a) => (
              <li key={a.id} className={cn("card flex flex-wrap items-center gap-3 p-3", a.severita === "critico" ? "border-danger/50 bg-danger-soft" : "border-warn/40 bg-warn-soft")}>
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="font-medium">{nome(a.ubicazione_id)} · {TIPI_ALLARME[a.tipo]}{a.severita === "critico" && <Badge tono="danger" className="ml-2">Critico</Badge>}</p>
                  <p className="text-xs text-muted">{a.dettaglio}{a.valore_estremo != null && <> · valore estremo <span className="num">{num(a.valore_estremo, 1)} °C</span></>} · aperto il {dataOra(a.aperto_il)}{a.stato === "in_carico" && " · preso in carico"}</p>
                  {a.note && <p className="text-xs text-muted">Note: {a.note}</p>}
                  {a.tipo === "fuori_scala" && <p className="text-xs text-muted">Compatibile con un guasto o uno scollegamento del sensore: va verificato sul posto.</p>}
                </div>
                {operativo && (
                  <div className="flex gap-1.5">
                    {a.stato === "aperto" && <Azione rpc="gestisci_allarme" parametri={{ p_allarme_id: a.id, p_azione: "prendi" }} etichetta="Prendo in carico" motivo={{ parametro: "p_nota", domanda: "Nota (facoltativa): cosa stai controllando?", facoltativo: true }} />}
                    <Azione rpc="gestisci_allarme" parametri={{ p_allarme_id: a.id, p_azione: "risolvi" }} etichetta="Risolvi" stile="btn btn-sm btn-ok" motivo={{ parametro: "p_nota", domanda: "Cosa è stato fatto per risolvere l'allarme? (obbligatorio, resta nel registro)" }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {celle.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {celle.map((u) => {
            const s = STATI[u.stato_temperatura] ?? STATI.nessun_dato;
            return (
              <li key={u.id}>
                <Link href={`/celle?cella=${u.id}`} scroll={false} aria-current={scelta?.id === u.id ? "true" : undefined}
                  className={cn("card block p-4 transition-colors hover:border-line-strong", scelta?.id === u.id && "border-fg/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{u.nome}</p><p className="text-xs text-subtle">{u.tipo}{u.posizione ? ` · ${u.posizione}` : ""}</p></div>
                    <Badge tono={s.tono}>{s.testo}</Badge>
                  </div>
                  <p className={cn("num mt-4 text-3xl font-medium leading-none", u.stato_temperatura === "ok" ? "text-fg" : u.ultima_temperatura == null ? "text-subtle" : "text-warn")}>
                    {u.ultima_temperatura != null ? <>{num(u.ultima_temperatura, 1)}<span className="text-base text-subtle"> °C</span></> : "—"}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {u.ultima_lettura_il ? <>{dataOra(u.ultima_lettura_il)} · {u.ultima_fonte === "sensore" ? "da sensore" : "inserita a mano"}</> : "Nessuna lettura valida"}
                  </p>
                  <p className="mt-0.5 text-xs text-subtle">Intervallo: {intervallo(u)} · {u.n_sensori > 0 ? `${u.n_sensori} sensori` : "nessun sensore collegato"}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <div className="card"><Vuoto titolo="Nessuna cella registrata">{titolare ? "Aggiungi la prima cella qui sotto, con le soglie del tuo piano HACCP." : "Il titolare può aggiungere celle, frigoriferi e congelatori."}</Vuoto></div>}

      {scelta && (
        <section className="mt-4 space-y-3" aria-label={`Dettaglio ${scelta.nome}`}>
          <div className="card overflow-x-auto">
            <div className="px-4 pt-4"><h2 className="text-[13px] font-medium">{scelta.nome} · ultime letture</h2></div>
            {letture?.length ? (
              <table className="mt-2 w-full min-w-[520px] text-[13px]">
                <thead><tr><th scope="col" className="th">Quando</th><th scope="col" className="th text-right">Valore</th><th scope="col" className="th">Fonte</th><th scope="col" className="th">Qualità del dato</th><th scope="col" className="th">Nota</th></tr></thead>
                <tbody>{letture.map((l) => {
                  const fuori = l.qualita === "valida" && ((scelta.temp_max != null && l.valore > scelta.temp_max) || (scelta.temp_min != null && l.valore < scelta.temp_min));
                  return (
                    <tr key={l.id} className="riga">
                      <td className="td num whitespace-nowrap text-muted">{dataOra(l.rilevata_il)}</td>
                      <td className={cn("td num text-right", fuori && "text-warn", l.qualita !== "valida" && "text-subtle line-through")}>{num(l.valore, 1)} °C</td>
                      <td className="td text-xs text-muted">{l.fonte === "sensore" ? "Sensore" : "Manuale"}</td>
                      <td className="td">{l.qualita === "valida" ? <span className="text-xs text-muted">Valida</span> : <Badge tono="warn">{l.qualita === "fuori_scala" ? "Fuori scala: non considerata" : "Sensore da calibrare"}</Badge>}</td>
                      <td className="td text-xs text-muted">{l.nota ?? ""}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            ) : <Vuoto compatto titolo="Nessuna lettura">Collega un sensore oppure registra una lettura a mano.</Vuoto>}
          </div>

          <div className="card p-4">
            <h2 className="text-[13px] font-medium">Sensori</h2>
            {sensori?.length ? (
              <ul className="mt-2 divide-y divide-line">
                {sensori.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
                    <span className="flex-1">{s.nome}{s.identificativo_esterno && <span className="num text-xs text-subtle"> · {s.identificativo_esterno}</span>}</span>
                    <span className="text-xs text-muted">{s.ultima_lettura_il ? `ultima trasmissione ${dataOra(s.ultima_lettura_il)}` : "mai trasmesso"}</span>
                    <Badge tono={s.stato === "attivo" ? "ok" : s.stato === "da_calibrare" ? "warn" : "neutro"}>{s.stato === "attivo" ? "Attivo" : s.stato === "da_calibrare" ? "Da calibrare" : "Disattivato"}</Badge>
                    {titolare && s.stato !== "disattivato" && (
                      <>
                        <Azione rpc="imposta_stato_sensore" parametri={{ p_sensore_id: s.id, p_stato: s.stato === "da_calibrare" ? "attivo" : "da_calibrare" }} etichetta={s.stato === "da_calibrare" ? "Calibrato" : "Segna da calibrare"} stile="btn btn-ghost btn-sm" />
                        <Azione rpc="imposta_stato_sensore" parametri={{ p_sensore_id: s.id, p_stato: "disattivato" }} etichetta="Disattiva" stile="btn btn-ghost btn-sm" conferma={`Disattivare ${s.nome}? La sua chiave verrà revocata e non potrà più trasmettere.`} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-muted">Nessun sensore collegato a questa cella. L&apos;integrazione è predisposta: ogni sensore riceve una chiave e trasmette a <span className="num">/api/sensori/letture</span>. Finché non ne colleghi uno, le letture vanno registrate a mano.</p>}
            {titolare && (
              <div className="mt-4 border-t border-line pt-4">
                <Modulo rpc="crea_sensore" fissi={{ p_ubicazione_id: scelta.id }} compatto invio="Collega un sensore" fatto="Sensore creato"
                  campi={[{ nome: "p_nome", etichetta: "Nome del sensore", richiesto: true }, { nome: "p_identificativo_esterno", etichetta: "Identificativo del dispositivo" }]}
                  risultato={{ chiave: "chiave", etichetta: "Chiave del sensore: copiala ora", nota: "Va configurata nel dispositivo o nel suo gateway (header X-Sensore-Chiave). Non verrà più mostrata." }} />
              </div>
            )}
          </div>

          {operativo && (
            <Espandi titolo="Registra una lettura a mano (riserva quando il sensore non c'è o non trasmette)">
              <Modulo rpc="registra_lettura" fissi={{ p_ubicazione_id: scelta.id }} compatto invio="Registra" fatto="Lettura registrata"
                campi={[{ nome: "p_valore", etichetta: "Temperatura (°C)", tipo: "numero", richiesto: true }, { nome: "p_rilevata_il", etichetta: "Quando", tipo: "dataora", aiuto: "Vuoto = adesso" }, { nome: "p_nota", etichetta: "Nota" }]} />
            </Espandi>
          )}
          {titolare && <Espandi titolo="Soglie e dati della cella"><Modulo rpc="salva_ubicazione" fissi={{ p_ristorante_id: "@sede", p_ubicazione_id: scelta.id }} inDati="p_dati" campi={campiSoglie(scelta)} invio="Salva" conferma="Cambiare le soglie modifica quando scattano gli allarmi. Confermi?" /></Espandi>}
        </section>
      )}

      {titolare && <div className="mt-4"><Espandi titolo="Aggiungi una cella, un frigorifero o un congelatore" aperto={!celle.length}><Modulo rpc="salva_ubicazione" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" campi={campiSoglie()} invio="Aggiungi" /></Espandi></div>}

      <p className="mt-6 text-[11px] leading-relaxed text-subtle">
        Gli intervalli sono soglie operative impostate dal ristorante. L&apos;app registra e segnala, ma non attesta la conformità HACCP né sostituisce il piano di autocontrollo e le sue registrazioni obbligatorie.
        Un allarme scatta solo se la temperatura resta fuori intervallo per la durata indicata e si chiude da solo quando rientra oltre il margine impostato; una lettura assente apre un allarme «dati mancanti» e non viene mai mostrata come temperatura in regola.
      </p>
      {(allarmi ?? []).some((a) => a.stato === "risolto") && (
        <div className="mt-4"><Espandi titolo="Allarmi chiusi di recente">
          <ul className="space-y-2 text-xs">{(allarmi ?? []).filter((a) => a.stato === "risolto").slice(0, 15).map((a) => (
            <li key={a.id} className="text-muted"><span className="text-fg">{nome(a.ubicazione_id)} · {TIPI_ALLARME[a.tipo]}</span> · {dataOra(a.aperto_il)} → {dataOra(a.risolto_il)} · {a.risolto_auto ? "chiuso automaticamente" : "chiuso da una persona"}{a.note ? ` · ${a.note}` : ""}</li>
          ))}</ul>
        </Espandi></div>
      )}
    </>
  );
}
