# Price Guardian Enterprise

Contabilità invisibile e controllo prezzi per la ristorazione di lusso cross-border (Italia, Francia, Monaco, Svizzera).

```
Browser ──(1) prenota: ruolo, sede, impronta SHA-256──▶ Supabase (RPC crea_caricamento)
   │──(2) upload diretto con URL firmato──────────────▶ Storage  documenti/{ristorante_id}/{documento_id}.ext
   │──(3) server action: {documento_id} + token───────▶ n8n  → risponde 202 e lavora in background
   ◀─(5) stato in tempo reale (Realtime, filtrato RLS)─ Supabase
                                                         ▲
n8n: scarica il file → Claude estrae → registra_documento → abbinamento al catalogo → completa_documento
```

| Cartella | Contenuto |
|---|---|
| `supabase/migrations/` | Schema, RLS, audit, RPC (applicate al progetto `zbvmkrgxwwjritdarvzh`) |
| `supabase/functions/embed/` | Edge Function: embedding `gte-small` (384 dimensioni) per alias e master |
| `n8n/` | Prompt, codice dei nodi e definizione dei due workflow |
| `web/` | Web app Next.js 15 + Tailwind 4 (deploy Vercel, Root Directory `web`) |

## Modello dei dati

- **Gruppo → ristoranti (sedi).** Catalogo master, alias e fornitori sono del gruppo; documenti, righe e prezzi sono della singola sede (`ristorante_id`).
- **Ruoli** (`membri_ristorante`, `membri_gruppo`): titolare, chef, contabile, sola lettura. Il ruolo di sede prevale su quello di gruppo.
- **Nessuna scrittura diretta dal client.** La RLS consente solo la lettura filtrata; ogni modifica passa da una RPC `security definer` che verifica il ruolo.

| Azione | Titolare | Chef | Contabile | Sola lettura |
|---|:-:|:-:|:-:|:-:|
| Caricare documenti, correggere le righe, contestare un rincaro | ✓ | ✓ | ✓ | |
| Correggere i dati di testata del documento | ✓ | | ✓ | |
| Validare gli abbinamenti al catalogo | ✓ | ✓ | | |
| Approvare rincari e nuovi articoli master, unire o revocare | ✓ | | | |
| Impostazioni e team | ✓ | | | |
| Consultare e verificare l'audit | ✓ | | ✓ | |

## Audit trail

Ogni INSERT/UPDATE/DELETE sulle tabelle contabili scrive in `audit_log`: valori prima e dopo, utente, origine (app, n8n, sql), IP dichiarato dall'app e IP della connessione. Le righe sono concatenate con SHA-256, una catena per gruppo, serializzata con `pg_advisory_xact_lock`. UPDATE, DELETE e TRUNCATE sono bloccati da trigger e i privilegi di scrittura sono revocati a tutti i ruoli API.

```sql
select * from verifica_audit();   -- sequenza, concatenazione e hash ricalcolato
```

Il primo di ogni mese il registro del mese precedente viene archiviato nel bucket `archivio-audit` insieme all'ultimo hash, che fa da ancora esterna. Nota: questo registro non sostituisce la conservazione a norma delle fatture elettroniche.

## Stati del documento

`in_coda → elaborazione (estrazione → abbinamento) → completato`, oppure `errore` / `duplicato`.

- **Idempotenza:** stesso file (SHA-256) nella stessa sede → non viene ricaricato. Stesso documento contabile (fornitore, tipo, numero, data) → marcato `duplicato`.
- **Timeout:** `pg_cron` porta a `errore` i documenti fermi da più di 5 minuti; dall'app si può riprovare.

## Catalogo master e abbinamento

1. **Alias esatto** (fornitore + codice o descrizione): eredita il master già confermato, senza IA.
2. **Somiglianza:** trigrammi (`pg_trgm`) più embedding (`pgvector`). Sopra 0,92 con distacco netto l'abbinamento è automatico.
3. **Giudice (Claude)** solo sui casi incerti: confidenza ≥ 0,85 automatico, 0,50–0,85 proposta nella coda «Da validare», «nuovo» → master in bozza da approvare.

Ogni conferma umana diventa un alias permanente. Le soglie sono in `gruppi`.

**Prezzi confrontabili.** Ogni riga viene riportata all'unità base del master: conversione diretta (g→kg, cl→lt), peso reale della riga (tagli a peso variabile), fattore dell'alias («cartone 6×1 lt» → 6), contenuto letto dal documento. Il rincaro si calcola sul prezzo netto di sconto, rispetto all'acquisto cronologicamente precedente dallo stesso fornitore, nella valuta originale. Il controvalore in EUR usa l'ultimo tasso BCE disponibile alla data del documento (`tassi_cambio`).

## n8n

| Workflow | Funzione |
|---|---|
| `Price Guardian: acquisizione documenti` | Webhook `POST /webhook/price-guardian/documento` con `{documento_id}` e header `X-Price-Guardian-Token` |
| `Price Guardian: manutenzione (tassi BCE e archivio audit)` | Ogni giorno alle 17:30: tassi BCE; il primo del mese: archivio audit |

`n8n/codice/` e i due file di prompt sono la fonte del codice dei nodi; `workflow.operazioni.json` contiene le operazioni applicate al workflow principale, `manutenzione.sdk.ts` la definizione del secondo.

## Web app

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Variabili d'ambiente (anche su Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_HEADER`, `N8N_WEBHOOK_TOKEN` (solo server).

Pagine: Panoramica, Documenti, dettaglio affiancato (originale + dati modificabili), Carica, Da validare, Rincari, Catalogo, Impostazioni (sede, team, audit). Tema scuro «Midnight Obsidian» predefinito, tema chiaro opzionale.

## Limiti noti

- Gli embedding usano `gte-small`, pensato soprattutto per l'inglese: servono ad ampliare la rosa dei candidati, la decisione spetta a trigrammi e giudice. Un modello multilingue richiede una chiave API esterna.
- Le FatturaPA firmate `.p7m` vanno estratte in XML prima del caricamento.
- I nuovi utenti si creano in Supabase → Authentication; poi si assegnano alla sede da Impostazioni → Team.
- Una nuova sede o un nuovo gruppo si creano per ora da SQL.
