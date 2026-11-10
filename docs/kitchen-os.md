# Kitchen OS Enterprise — moduli operativi

Estende Price Guardian (acquisti e prezzi) con magazzino, celle, ricette, fornitori, cantina e
manutenzione. Stampa e gestione delle etichette sono escluse per scelta.

## Principi comuni

- **Lettura** con RLS per sede (`app.ha_accesso_ristorante`); **scrittura** solo tramite RPC `security definer`.
- Ogni RPC operativa passa da `app.richiedi_op(sede, ruoli, funzione)`: verifica **ruolo e piano** insieme.
  Il piano non aggira il ruolo e il ruolo non aggira il piano.
- **Registri immutabili**: `movimenti`, `letture`, `vendite` non si modificano né si cancellano (trigger
  `app.immutabile`). Si correggono con uno storno motivato (`storna_movimento`, `storna_vendita`) o con una
  rettifica (`conta_lotto`). L'originale resta leggibile.
- **Audit**: le nuove tabelle anagrafiche e decisionali entrano nella catena di hash esistente (`audit_log`).
  Token d'invito e chiavi dei sensori stanno in tabelle separate (`inviti_segreti`, `sensori_segreti`), solo
  come hash SHA-256, senza audit e senza privilegi per i ruoli API.
- **Nessun dato inventato**: pesi, rese, conversioni, soglie, valori di mercato non vengono mai presunti.
  Quando manca un dato il risultato è marcato «incompleto» e dice che cosa serve.

## Migrazioni

| File | Contenuto |
|---|---|
| `20261112090000_kitchen_os_base.sql` | piani ed entitlements, inviti, conversioni, ubicazioni, sensori, letture, allarmi, lotti, movimenti |
| `20261112091000_kitchen_os_ricette_fornitori_manutenzione.sql` | ricette versionate, vendite, consegne, non conformità, scorecard, ordini proposti, attrezzature, piani, interventi |

In produzione sono state applicate in cinque passaggi (`kitchen_os_base_1…3`, `kitchen_os_2a`, `kitchen_os_2b`)
con lo stesso contenuto; l'unica aggiunta è l'attivazione anticipata di RLS e revoche sulle tabelle appena
create, per non lasciarle esposte tra un passaggio e l'altro. Le 55 funzioni in produzione sono state
confrontate per hash con quelle del database di test.

Sono additive: l'unico dato esistente toccato è l'assegnazione del piano «completo», stato «attivo»,
provider «manuale» ai gruppi già presenti, perché nessuno perda funzioni prima che esistano prezzi e condizioni.

## Piani ed entitlements

Tabelle `piani`, `funzionalita`, `piano_funzionalita`, `piano_limiti`, `abbonamenti`. **Non contengono prezzi.**

| Piano | Funzioni |
|---|---|
| essenziale | acquisti |
| operativo | acquisti, magazzino, celle, manutenzione |
| completo | + ricette, fornitori, cantina |

La ripartizione è una proposta tecnica modificabile con un `update` sulle tabelle, non un'offerta commerciale.
I limiti (`sedi`, `utenti`) sono `NULL` = non impostati. Stati: `prova`, `attivo`, `scaduto`, `sospeso`,
`annullato`. Con abbonamento non attivo i dati restano consultabili ed esportabili, ma ogni scrittura è
rifiutata dal database (errore `P0403`). Una prova senza `prova_fino_al` non scade.
`imposta_abbonamento` è eseguibile solo dal ruolo di servizio.

**Pagamenti**: `web/lib/pagamenti.ts` e `/api/pagamenti/webhook` sono *predisposti*. Il webhook risponde 501.
Non esiste checkout, non esistono prezzi, nessun incasso è possibile.

## Inviti

Il titolare invita per email, ruolo e sede (o intero gruppo, se titolare del gruppo). `crea_invito` restituisce
il token una sola volta; in database resta l'hash. Scadenza 1–30 giorni (predefinito 7). Reinvitare la stessa
email rinnova l'invito e invalida il link precedente. `accetta_invito` richiede: sessione attiva, email
dell'account identica a quella invitata, email verificata, invito non scaduto né revocato; poi cancella l'hash,
quindi il link non è riutilizzabile. La password la sceglie l'invitato tramite Supabase Auth: l'app non la
vede, non la invia e non la registra.

**Email**: adapter Resend (`web/lib/email.ts`). Senza `RESEND_API_KEY` e `EMAIL_MITTENTE` l'invio non avviene,
l'invito risulta «non inviato» e l'interfaccia mostra il link da consegnare a mano.

## Moduli

**Celle e temperature.** Ubicazioni con soglie min/max, durata minima fuori intervallo prima dell'allarme,
isteresi per il rientro, soglia di criticità e allarme per dati mancanti. Letture manuali o da sensore.
Adapter IoT: `POST /api/sensori/letture` con intestazione `X-Sensore-Chiave` e corpo
`{"valore": 3.4, "rilevata_il": "…", "idempotenza": "…"}`. Nessun sensore reale è collegato: l'endpoint è
verificato solo dai test. Un controllo ogni 5 minuti (pg_cron) apre gli allarmi per dati mancanti.

**Magazzino.** Lotti con scadenza, costo storico e cambio BCE della data; movimenti con segno; suggerimento di
prelievo FEFO, o FIFO senza scadenza (solo suggerimento); blocco e richiamo; trasferimenti tra ubicazioni e sedi.

**Conversioni.** Peso↔peso e volume↔volume sono fisiche. Tra dimensioni diverse (pezzi, confezioni, peso,
volume) vale solo una conversione dichiarata per articolo, versionata e con provenienza (`conversioni_unita`).

**Ricette e food cost.** Ogni salvataggio crea una versione. Costo = quantità lorda × ultimo prezzo netto di
acquisto nella sede (EUR al cambio della fattura), con fonte per riga. Quantità netta senza resa, unità non
convertibile o prezzo assente ⇒ «incompleto». Vendite manuali o da CSV (idempotenti). Nessun POS è collegato.

**Fornitori.** Consegne, non conformità, indicatori con numero di eventi, punteggio pesato con pesi e campione
minimo scelti dal titolare. Ordini: solo proposte interne; l'approvazione non invia nulla a nessuno.

**Cantina.** Lotti di tipo `cantina` con produttore, annata, formato e finestra di consumo con fonte.
Nessuna stima di valore di mercato o patrimoniale: è mostrato solo il costo storico d'acquisto.

**Manutenzione.** Attrezzature, piani a tempo o a contatore, interventi e guasti. Una scadenza «obbligatoria»
richiede la fonte (norma o documento). L'app non contatta assistenze tecniche.

## HACCP e normativa — NON verificato

Le fonti ufficiali (EUR-Lex, Reg. CE 852/2004 e 853/2004) non erano raggiungibili dall'ambiente di sviluppo.
Per questo l'app **non contiene soglie di temperatura predefinite, non classifica le scadenze come obbligatorie
di propria iniziativa e non attesta alcuna conformità**. Le soglie le inserisce il ristorante dal proprio piano
di autocontrollo. I registri prodotti sono un supporto, non un sostituto della documentazione prevista dalla legge.

## Stato delle integrazioni

| Integrazione | Stato |
|---|---|
| Supabase (dati, auth, storage, realtime), n8n (documenti, tassi BCE, archivio audit) | reale, in produzione |
| Email inviti (Resend) | adapter completo, da configurare; senza chiavi nessun invio |
| Sensori IoT | endpoint e autenticazione pronti, nessun dispositivo collegato |
| POS | solo import CSV; nessun collegamento diretto |
| Pagamenti (Stripe) | predisposto, non attivo, nessun incasso possibile |
| Notifiche di allarme fuori dall'app (SMS, email, push) | non realizzate: gli allarmi si vedono solo nell'app |

## Rischi

| Rischio | Gravità | Mitigazione |
|---|---|---|
| Allarme temperatura non visto perché nessuno ha l'app aperta | alta | manca un canale di notifica esterno: da decidere |
| Soglie inserite sbagliate | alta | solo il titolare le modifica, modifica in audit; nessun valore proposto |
| Sensore fermo scambiato per «tutto bene» | alta | stato «dati mancanti» e allarme dedicato, se configurato il silenzio massimo |
| Conversione dichiarata errata che falsa costi e giacenze | media | versionata, con provenienza, conferma esplicita |
| Food cost letto come contabile | media | etichettato «teorico», periodo e fonte sempre visibili |
| Interfaccia dei nuovi moduli non provata con un utente reale | media | build e tipi verificati, logica coperta da test SQL; serve una prova manuale |

## Test

`supabase/tests/esegui.sh` (PostgreSQL locale): 271 asserzioni su piani, ruoli, inviti, isolamento tra sedi e
gruppi, immutabilità, storni, FEFO/FIFO, conversioni, allarmi, costi, scorecard, catena di audit.
`npm test` in `web/`: 10 test su controlli, numeri e stati di pagamento. Dati esclusivamente fittizi.
