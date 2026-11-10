// Adapter per l'invio di email transazionali (oggi: gli inviti).
// Stato: PREDISPOSTO. Senza RESEND_API_KEY ed EMAIL_MITTENTE non viene inviato nulla
// e l'esito lo dice esplicitamente: l'interfaccia mostra il link da consegnare a mano.
export type EsitoEmail = { inviata: true } | { inviata: false; motivo: "non_configurata" | "errore"; dettaglio: string };

export function emailConfigurata() {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_MITTENTE;
}

const sicuro = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function modelloInvito(d: { sede: string; ruolo: string; link: string; scadenza: string; invitante: string }) {
  const oggetto = `Invito a collaborare su ${d.sede}`;
  const testo = `${d.invitante} ti ha invitato a collaborare su ${d.sede} con il ruolo ${d.ruolo}.\n\nApri questo collegamento per creare la tua password e accedere:\n${d.link}\n\nIl collegamento è personale, si usa una sola volta e scade il ${d.scadenza}.\nSe non aspettavi questo invito puoi ignorare il messaggio.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#18181b">
<h1 style="font-size:18px">Invito a collaborare</h1>
<p>${sicuro(d.invitante)} ti ha invitato a collaborare su <strong>${sicuro(d.sede)}</strong> con il ruolo <strong>${sicuro(d.ruolo)}</strong>.</p>
<p><a href="${sicuro(d.link)}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Accetta l'invito</a></p>
<p style="font-size:13px;color:#52525b">Il collegamento è personale, si usa una sola volta e scade il ${sicuro(d.scadenza)}. Se non aspettavi questo invito puoi ignorare il messaggio.</p></div>`;
  return { oggetto, testo, html };
}

export async function inviaEmail(a: string, m: { oggetto: string; testo: string; html: string }): Promise<EsitoEmail> {
  if (!emailConfigurata()) return { inviata: false, motivo: "non_configurata", dettaglio: "Invio email non configurato" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_MITTENTE, to: [a], subject: m.oggetto, text: m.testo, html: m.html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return { inviata: false, motivo: "errore", dettaglio: `Il servizio email ha risposto ${r.status}` };
    return { inviata: true };
  } catch {
    return { inviata: false, motivo: "errore", dettaglio: "Il servizio email non risponde" };
  }
}
