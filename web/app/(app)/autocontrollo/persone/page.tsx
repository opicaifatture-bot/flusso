import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { dataOra } from "@/lib/format";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi, Modulo } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { ImpostaPin } from "./pin";

export const metadata: Metadata = { title: "Persone e PIN" };

type Persona = { id: string; nome: string; mansione: string | null; attiva: boolean; note: string | null };

export default async function Persone() {
  const { supabase, attivo, ruolo, piano, inclusa, scrivibile } = await sessioneModulo("autocontrollo");
  const [{ data: persone }, { data: pin }] = await Promise.all([
    supabase.from("persone").select("id,nome,mansione,attiva,note").eq("ristorante_id", attivo.id)
      .order("attiva", { ascending: false }).order("nome").returns<Persona[]>(),
    supabase.rpc("stato_pin", { p_ristorante_id: attivo.id }),
  ]);
  const pinDi = new Map(((pin ?? []) as { persona_id: string; impostato_il: string; bloccato: boolean }[]).map((x) => [x.persona_id, x]));
  const gestisce = scrivibile && (ruolo === "titolare" || ruolo === "chef" || ruolo === "consulente");
  const puoPin = scrivibile && (ruolo === "titolare" || ruolo === "chef");

  return (
    <>
      <Intestazione titolo="Autocontrollo" sottotitolo={attivo.nome} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="persone" />
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        Chi lavora in cucina non ha bisogno di un account: basta essere in questo elenco con un PIN personale.
        Sul tablet di cucina ognuno sceglie il proprio nome e inserisce il PIN, così ogni registrazione risulta firmata da chi l&apos;ha fatta.
        Dopo 5 PIN errati la persona resta bloccata per 15 minuti. Le persone non si cancellano, si disattivano: le loro firme restano valide.
      </p>
      {gestisce && <div className="mb-4"><Espandi titolo="Aggiungi una persona" aperto={!persone?.length}>
        <Modulo rpc="salva_persona" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Aggiungi" fatto="Persona aggiunta" campi={[
          { nome: "nome", etichetta: "Nome e cognome", richiesto: true }, { nome: "mansione", etichetta: "Mansione", segnaposto: "es. Cuoco, Lavapiatti, Sala" },
          { nome: "note", etichetta: "Note", largo: true }]} />
      </Espandi></div>}
      {persone?.length ? (
        <ul className="card divide-y divide-line">{persone.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{p.nome} {!p.attiva && <Badge>Non attiva</Badge>}</p>
              <p className="text-xs text-muted">{p.mansione ?? "Mansione non indicata"}{p.note ? ` · ${p.note}` : ""}</p>
              <p className="mt-0.5 text-xs">{pinDi.get(p.id) ? <span className="text-ok">PIN impostato il {dataOra(pinDi.get(p.id)!.impostato_il)}{pinDi.get(p.id)!.bloccato && <span className="text-danger"> · bloccato per troppi tentativi</span>}</span> : <span className="text-warn">PIN non impostato</span>}</p>
            </div>
            {p.attiva && puoPin && <ImpostaPin persona={p.id} nome={p.nome} haPin={pinDi.has(p.id)} />}
            {gestisce && <Azione rpc="salva_persona" parametri={{ p_ristorante_id: "@sede", p_persona_id: p.id, p_dati: { attiva: !p.attiva } }}
              etichetta={p.attiva ? "Disattiva" : "Riattiva"} conferma={p.attiva ? `Disattivare ${p.nome}? Non potrà più firmare registrazioni; quelle già fatte restano.` : undefined} />}
          </li>
        ))}</ul>
      ) : <Vuoto titolo="Nessuna persona">Aggiungi chi lavora in cucina e in sala: servirà per le firme dei registri e per la formazione.</Vuoto>}
    </>
  );
}
