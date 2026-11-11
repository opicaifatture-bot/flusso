import { sessioneModulo } from "./sessione";

/** Sede, permessi e persone attive: quello che serve a ogni pagina dell'autocontrollo. */
export async function contestoAutocontrollo() {
  const s = await sessioneModulo("autocontrollo");
  const { data: persone } = await s.supabase.from("persone").select("id,nome").eq("ristorante_id", s.attivo.id).eq("attiva", true)
    .order("nome").returns<{ id: string; nome: string }[]>();
  const r = s.ruolo;
  return {
    ...s, persone: persone ?? [],
    /** Con l'account Cucina chi registra deve scegliersi e inserire il PIN. */
    pinObbligatorio: r === "cucina",
    puoRegistrare: s.scrivibile && (r === "titolare" || r === "chef" || r === "cucina" || r === "consulente"),
    puoPianificare: s.scrivibile && (r === "titolare" || r === "consulente"),
    puoGestire: s.scrivibile && (r === "titolare" || r === "chef" || r === "consulente"),
    oggi: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date()),
  };
}
