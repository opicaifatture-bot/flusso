import type { Metadata } from "next";
import { sessioneSede } from "@/lib/sessione";
import { dataOra } from "@/lib/format";
import type { Ruolo } from "@/lib/tipi";
import { Avviso, Badge, Intestazione } from "@/components/ui";
import { ModuloSede, ModuloTeam, VerificaAudit } from "./moduli";

export const metadata: Metadata = { title: "Impostazioni" };

const TABELLE: Record<string, string> = {
  documenti: "Documento", storico_prezzi: "Riga", alias_articolo: "Abbinamento", articoli_master: "Catalogo",
  categorie_master: "Categoria", fornitori: "Fornitore", fornitori_ristorante: "Fornitore", ristoranti: "Sede",
  gruppi: "Gruppo", membri_ristorante: "Team", membri_gruppo: "Team",
};
const OPERAZIONI: Record<string, string> = { INSERT: "Creazione", UPDATE: "Modifica", DELETE: "Eliminazione" };
const ORIGINI: Record<string, string> = { app: "Web app", n8n: "Automazione", sql: "Database", sistema: "Sistema" };
type Voce = { id: number; seq: number; tabella: string; operazione: string; origine: string; utente_id: string | null; ip: string | null; creato_il: string; dopo: Record<string, unknown> | null };

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
    supabase.from("audit_log").select("id,seq,tabella,operazione,origine,utente_id,ip,creato_il,dopo").eq("gruppo_id", attivo.gruppo_id)
      .order("seq", { ascending: false }).limit(25).returns<Voce[]>(),
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
      <Sezione titolo="Registro di audit" testo="Ogni modifica ai dati contabili viene registrata con autore, data e indirizzo IP. Le registrazioni sono concatenate con hash SHA-256: non si possono modificare né cancellare senza che la verifica lo rilevi.">
        <VerificaAudit />
        <div className="mt-5 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr><th className="th">N.</th><th className="th">Quando</th><th className="th">Cosa</th><th className="th">Origine</th><th className="th">Autore</th><th className="th">IP</th></tr></thead>
            <tbody>
              {(registro ?? []).map((v) => (
                <tr key={v.id} className="riga">
                  <td className="td num text-subtle">{v.seq}</td>
                  <td className="td num whitespace-nowrap text-muted">{dataOra(v.creato_il)}</td>
                  <td className="td">{OPERAZIONI[v.operazione] ?? v.operazione} · <span className="text-muted">{TABELLE[v.tabella] ?? v.tabella}</span>
                    {v.operazione === "UPDATE" && v.dopo && <span className="text-subtle"> ({Object.keys(v.dopo).slice(0, 3).join(", ")}{Object.keys(v.dopo).length > 3 ? "…" : ""})</span>}
                  </td>
                  <td className="td"><Badge tono={v.origine === "app" ? "info" : "neutro"}>{ORIGINI[v.origine] ?? v.origine}</Badge></td>
                  <td className="td text-muted">{v.utente_id ? (v.utente_id === user.id ? "Tu" : `…${v.utente_id.slice(-4)}`) : "—"}</td>
                  <td className="td num text-subtle">{v.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-subtle">Ultime 25 registrazioni. Il primo di ogni mese il registro del mese precedente viene archiviato nel bucket protetto «archivio-audit».</p>
      </Sezione>
    </div>
  );
}
