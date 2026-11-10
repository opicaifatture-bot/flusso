import type { Metadata } from "next";
import { pianoCorrente, sessioneSede } from "@/lib/sessione";
import { ETICHETTE_STATO, pagamentiConfigurati } from "@/lib/pagamenti";
import { emailConfigurata } from "@/lib/email";
import { data as fmtData } from "@/lib/format";
import type { Ruolo } from "@/lib/tipi";
import { Avviso, Badge, Intestazione } from "@/components/ui";
import { ModuloInviti, ModuloSede, ModuloTeam, RegistroAudit, VerificaAudit, type InvitoRiga } from "./moduli";
import type { VoceAudit } from "./actions";

export const metadata: Metadata = { title: "Impostazioni" };

function Sezione({ titolo, testo, children }: { titolo: string; testo: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 first:border-0 first:pt-0 md:grid-cols-[240px_1fr] md:gap-10">
      <div><h2 className="text-sm font-medium">{titolo}</h2><p className="mt-1 text-xs leading-relaxed text-muted">{testo}</p></div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function Impostazioni() {
  const { supabase, user, attivo, permessi } = await sessioneSede();
  if (!permessi.impostazioni && !permessi.audit) {
    return <><Intestazione titolo="Impostazioni" /><Avviso tono="warn">Solo il titolare può modificare le impostazioni della sede.</Avviso></>;
  }
  const [piano, { data: inviti }, { data: funzioni }, { data: mieiGruppi }] = await Promise.all([
    pianoCorrente(attivo.gruppo_id),
    permessi.impostazioni
      ? supabase.from("inviti").select("id,email,ruolo,ristorante_id,stato,scade_il,invio_stato,invio_errore,invii,creato_il").eq("gruppo_id", attivo.gruppo_id)
          .or(`ristorante_id.eq.${attivo.id},ristorante_id.is.null`).order("creato_il", { ascending: false }).limit(30).returns<InvitoRiga[]>()
      : Promise.resolve({ data: [] as InvitoRiga[] }),
    supabase.from("funzionalita").select("codice,nome,descrizione").order("codice").returns<{ codice: string; nome: string; descrizione: string }[]>(),
    supabase.from("membri_gruppo").select("ruolo").eq("gruppo_id", attivo.gruppo_id).eq("user_id", user.id).returns<{ ruolo: string }[]>(),
  ]);
  const titolareGruppo = (mieiGruppi ?? []).some((m) => m.ruolo === "titolare");
  const [{ data: membri }, { data: registro }] = await Promise.all([
    permessi.impostazioni ? supabase.rpc("elenco_membri", { p_ristorante_id: attivo.id }) : Promise.resolve({ data: [] }),
    supabase.rpc("registro_audit", { p_gruppo_id: attivo.gruppo_id, p_limite: 25 }),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <Intestazione titolo="Impostazioni" sottotitolo={attivo.nome} />
      {permessi.impostazioni && (
        <>
          <Sezione titolo="Sede" testo="Dati del ristorante e soglia oltre la quale un aumento di prezzo viene segnalato."><ModuloSede sede={attivo} /></Sezione>
          <Sezione titolo="Invita un collaboratore" testo="Invia un collegamento personale a scadenza. La persona crea da sé la propria password: tu non la vedi mai.">
            <ModuloInviti inviti={inviti ?? []} sede={attivo.nome} puoGruppo={titolareGruppo} emailAttiva={emailConfigurata()} />
          </Sezione>
          <Sezione titolo="Team" testo="Chi ha già accesso a questa sede. Cambia il ruolo o rimuovi l'accesso: l'effetto è immediato.">
            <ModuloTeam membri={(membri ?? []) as { user_id: string; email: string; ruolo: Ruolo; livello: string }[]} io={user.id} />
          </Sezione>
        </>
      )}
      <section id="piano" className="grid gap-4 border-t border-line py-8 md:grid-cols-[240px_1fr] md:gap-10">
        <div><h2 className="text-sm font-medium">Piano</h2><p className="mt-1 text-xs leading-relaxed text-muted">Le funzioni disponibili per il gruppo. Ogni operazione richiede sia il ruolo adatto sia una funzione inclusa nel piano: il controllo avviene nel database.</p></div>
        <div className="min-w-0">
          {piano ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">{piano.nome}
                <Badge tono={piano.stato === "attivo" ? "ok" : piano.stato === "prova" ? "info" : "danger"}>{ETICHETTE_STATO[piano.stato]}</Badge></p>
              <p className="mt-1 text-xs text-muted">
                {piano.stato === "prova" && (piano.prova_fino_al ? <>Prova fino al {fmtData(piano.prova_fino_al)}. </> : <>Prova senza scadenza impostata. </>)}
                {piano.periodo_fine && <>Periodo corrente fino al {fmtData(piano.periodo_fine)}. </>}
                <span className="num">{piano.utenti}</span> utenti{piano.limiti.utenti ? <> su {piano.limiti.utenti}</> : null} · <span className="num">{piano.sedi}</span> {piano.sedi === 1 ? "sede" : "sedi"}{piano.limiti.sedi ? <> su {piano.limiti.sedi}</> : null}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {(funzioni ?? []).map((f) => {
                  const inclusa = piano.funzioni.includes(f.codice);
                  return (
                    <li key={f.codice} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs">
                      <span className={inclusa ? "text-ok" : "text-subtle"} aria-hidden>{inclusa ? "✓" : "—"}</span>
                      <span><span className={inclusa ? "font-medium" : "text-muted"}>{f.nome}</span><span className="sr-only">{inclusa ? " (inclusa)" : " (non inclusa)"}</span><span className="block text-subtle">{f.descrizione}</span></span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-subtle">
                {pagamentiConfigurati() ? "Pagamenti configurati." : "Il cambio di piano dall'app non è ancora disponibile: nessun sistema di pagamento è collegato e prezzi e condizioni non sono stati definiti. Oggi il piano viene assegnato a mano."}
                {" "}Se un abbonamento scade o viene sospeso, tutti i dati restano consultabili ed esportabili; si bloccano solo le nuove registrazioni. Un passaggio a un piano inferiore non cancella nulla.
              </p>
            </>
          ) : <Avviso tono="warn">Nessun piano assegnato a questo gruppo.</Avviso>}
        </div>
      </section>
      <Sezione titolo="Registro di audit" testo="Ogni creazione, modifica o eliminazione di dati contabili viene registrata dal database con autore, data e origine. Le registrazioni non si possono modificare né cancellare dall'app e sono concatenate con hash SHA-256.">
        <VerificaAudit />
        <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-subtle">
          <li>La verifica ricalcola tutta la catena: rileva una registrazione alterata o cancellata in mezzo. Non può rilevare, da sola, la rimozione delle ultime registrazioni da parte di chi amministra il database.</li>
          <li>Per questo è previsto un archivio esterno: il primo di ogni mese un&apos;automazione salva il registro del mese precedente e l&apos;ultimo hash nel bucket protetto «archivio-audit». Finché non è passato il primo fine mese, l&apos;archivio è vuoto.</li>
          <li>L&apos;indirizzo IP è un dato personale: lo vede solo il titolare. Fa parte della registrazione firmata, quindi resta conservato insieme al registro.</li>
          <li>Questo registro non sostituisce la conservazione a norma delle fatture elettroniche.</li>
        </ul>
        <RegistroAudit iniziali={(registro ?? []) as VoceAudit[]} io={user.id} vedeIp={permessi.impostazioni} />
      </Sezione>
    </div>
  );
}
