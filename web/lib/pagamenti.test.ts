import { test } from "node:test";
import assert from "node:assert/strict";
import { statoDaProvider, pagamentiConfigurati } from "./pagamenti.ts";
import { emailConfigurata, inviaEmail, modelloInvito } from "./email.ts";

test("stati del provider di pagamento", () => {
  assert.equal(statoDaProvider("trialing"), "prova");
  assert.equal(statoDaProvider("active"), "attivo");
  assert.equal(statoDaProvider("past_due"), "sospeso");
  assert.equal(statoDaProvider("canceled"), "annullato");
  assert.equal(statoDaProvider("sconosciuto"), "sospeso");
});

test("senza chiavi nessun provider risulta configurato e nessuna email viene data per inviata", async () => {
  assert.equal(pagamentiConfigurati(), false);
  assert.equal(emailConfigurata(), false);
  const esito = await inviaEmail("a@test.invalid", modelloInvito({ sede: "S", ruolo: "Chef", link: "https://x.invalid/invito/t", scadenza: "1 gen", invitante: "T" }));
  assert.deepEqual(esito, { inviata: false, motivo: "non_configurata", dettaglio: "Invio email non configurato" });
});

test("il modello dell'invito non contiene password e neutralizza l'HTML", () => {
  const m = modelloInvito({ sede: "<b>Sede</b>", ruolo: "Chef", link: "https://x.invalid/invito/abc", scadenza: "1 gen 2027", invitante: "Titolare" });
  assert.ok(m.testo.includes("https://x.invalid/invito/abc"));
  assert.ok(!/password\s*[:=]/i.test(m.testo));
  assert.ok(m.html.includes("&lt;b&gt;Sede&lt;/b&gt;"));
});
