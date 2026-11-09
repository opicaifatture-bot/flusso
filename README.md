# Price Guardian — Invisible Accounting & Price Guardian

MVP per ristoranti di lusso e clienti cross-border (Italia / Francia / Monaco / Svizzera).

```
Fattura XML / PDF / foto DDT
        │  POST (multipart o JSON base64)
        ▼
n8n "Price Guardian: acquisizione documenti"
  1. Prepara richiesta Claude   (XML → testo, PDF → document, immagine → vision)
  2. Archivia file originale    (Supabase Storage, bucket "documenti")
  3. Estrai dati con Claude     (prompt cross-border, traduzione IT, EUR/CHF)
  4. Valida e normalizza JSON   (numeri "1.234,56", unità di misura, date)
  5. Salva e controlla prezzi   (RPC registra_documento: upsert + variazione %)
  6. Risposta con anomalie
        ▼
Supabase (fornitori, documenti, articoli, storico_prezzi, v_anomalie)
        ▼
Web app Next.js (dashboard, badge anomalie, dettaglio, caricamento)
```

## Struttura

| Cartella | Contenuto |
|---|---|
| `supabase/migrations/` | Schema, RLS, funzione `registra_documento`, bucket storage (già applicati al progetto `zbvmkrgxwwjritdarvzh`) |
| `n8n/workflow.sdk.ts` | Sorgente del workflow n8n (già creato nell'istanza come bozza) |
| `n8n/prompt.txt` | Prompt di Document Intelligence usato da Claude |
| `web/` | Web app Next.js 15 + Tailwind 4 |

## Logica anti-rincari

La funzione `registra_documento(payload, p_file_url, p_soglia)` lavora in **una sola transazione**:

- **Fornitore**: upsert per P.IVA/ID estero normalizzato (spazi e prefissi rimossi), con la ragione sociale come ripiego.
- **Documento**: se lo stesso documento (fornitore, tipo, numero, data) arriva una seconda volta, viene sostituito e non duplicato.
- **Articolo**: upsert per `(fornitore, codice articolo)`; se manca il codice, usa la descrizione italiana normalizzata.
- **Storico prezzi**: confronta il prezzo con l'ultimo prezzo dello stesso articolo **nella stessa valuta**. Se la variazione supera `p_soglia` (default 5%), imposta `anomalia_prezzo = true`.

## Configurazione

### 1. n8n — credenziali da collegare
Apri il workflow e completa:

- **Ricevi documento** → credenziale *Header Auth* con nome header `X-Price-Guardian-Token` e un token lungo e casuale. (n8n ha assegnato in automatico la tua "Header Auth account" esistente: sostituiscila con una dedicata.)
- **Archivia file originale** e **Salva e controlla prezzi** → nuova credenziale *Supabase API*: Host `https://zbvmkrgxwwjritdarvzh.supabase.co`, Service Role Key presa da Supabase → Project Settings → API keys.
- **Estrai dati con Claude** → già collegato a "Anthropic account".

Poi pubblica il workflow. Test:

```bash
curl -X POST "https://teamopicai.app.n8n.cloud/webhook/price-guardian/documento" -H "X-Price-Guardian-Token: <TOKEN>" -F "data=@fattura.pdf"
```

### 2. Utente per la web app
Supabase → Authentication → Users → *Add user* (email + password). Le tabelle sono leggibili solo da utenti autenticati.

### 3. Web app
```bash
cd web
cp .env.example .env.local   # inserisci N8N_WEBHOOK_TOKEN
npm install
npm run dev
```
Per il deploy su Vercel imposta le stesse variabili d'ambiente.

## Limiti noti dell'MVP
- Se un documento viene caricato in ritardo, la variazione è calcolata rispetto all'ultimo prezzo **registrato**, non a quello cronologicamente precedente.
- Le FatturaPA firmate `.p7m` vanno estratte in XML prima dell'invio.
- I prezzi in valute diverse non vengono confrontati tra loro (non c'è conversione di cambio).
