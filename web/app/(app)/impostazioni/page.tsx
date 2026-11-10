import type { Metadata } from "next";
import { sessioneSede } from "@/lib/sessione";
import type { Ruolo } from "@/lib/tipi";
import { Avviso, Intestazione } from "@/components/ui";
import { ModuloSede, ModuloTeam, RegistroAudit, VerificaAudit } from "./moduli";
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
          <Sezione titolo="Team" testo="Chi può accedere a questa sede e con quale ruolo. Gli utenti si creano in Supabase → Authentication.">
            <ModuloTeam membri={(membri ?? []) as { user_id: string; email: string; ruolo: Ruolo; livello: string }[]} io={user.id} />
          </Sezione>
        </>
      )}
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
