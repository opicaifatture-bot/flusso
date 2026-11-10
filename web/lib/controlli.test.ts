import { test } from "node:test";
import assert from "node:assert/strict";
import { controlloDocumento, controlloFile, controlloRiga, leggiNumero, motivoConfronto, revisione } from "./controlli.ts";

test("leggiNumero: formati italiani e internazionali", () => {
  assert.equal(leggiNumero("1.234,56"), 1234.56);
  assert.equal(leggiNumero("12,5"), 12.5);
  assert.equal(leggiNumero("12.5"), 12.5);
  assert.equal(leggiNumero(" 2 400 "), 2400);
  assert.equal(leggiNumero("-3,2"), -3.2);
  assert.equal(leggiNumero(""), null);
  assert.equal(leggiNumero("abc"), undefined);
  assert.equal(leggiNumero("12,3,4"), undefined);
  assert.equal(leggiNumero("1e5"), undefined);
});

test("controlloRiga: totale coerente, con e senza sconto", () => {
  assert.deepEqual(controlloRiga({ quantita: 25, prezzo_unitario: 3.2, sconto_percentuale: 0, totale_riga: 80 }), { ok: true });
  assert.deepEqual(controlloRiga({ quantita: 4, prezzo_unitario: 39.9, sconto_percentuale: 5, totale_riga: 151.62 }), { ok: true });
  assert.deepEqual(controlloRiga({ quantita: 0.5, prezzo_unitario: 2400, sconto_percentuale: null, totale_riga: 1200 }), { ok: true });
});

test("controlloRiga: sconto dichiarato ma non applicato al totale", () => {
  assert.deepEqual(controlloRiga({ quantita: 4, prezzo_unitario: 39.9, sconto_percentuale: 5, totale_riga: 159.6 }),
    { ok: false, tipo: "sconto_non_applicato", atteso: 151.62 });
});

test("controlloRiga: totale incoerente, arrotondamenti e dati mancanti", () => {
  assert.deepEqual(controlloRiga({ quantita: 3, prezzo_unitario: 10, sconto_percentuale: null, totale_riga: 35 }),
    { ok: false, tipo: "totale_incoerente", atteso: 30 });
  assert.deepEqual(controlloRiga({ quantita: 3, prezzo_unitario: 3.333, sconto_percentuale: null, totale_riga: 10 }), { ok: true });
  assert.deepEqual(controlloRiga({ quantita: 1.005, prezzo_unitario: 1, sconto_percentuale: null, totale_riga: 1.01 }), { ok: true });
  assert.deepEqual(controlloRiga({ quantita: null, prezzo_unitario: 10, sconto_percentuale: null, totale_riga: 35 }), { ok: true });
  // nota di credito con totale negativo
  assert.deepEqual(controlloRiga({ quantita: 2, prezzo_unitario: 10, sconto_percentuale: null, totale_riga: -20 }), { ok: true });
});

test("controlloDocumento: somma righe, IVA e totale", () => {
  const righe = [{ totale_riga: 85 }, { totale_riga: 159.6 }, { totale_riga: 80 }];
  assert.deepEqual(controlloDocumento({ imponibile: 324.6, iva: 21.34, totale: 345.94 }, righe), []);
  assert.deepEqual(controlloDocumento({ imponibile: 300, iva: 30, totale: 330 }, righe), [{ tipo: "somma_righe", atteso: 300, trovato: 324.6 }]);
  assert.deepEqual(controlloDocumento({ imponibile: 324.6, iva: 21.34, totale: 400 }, righe), [{ tipo: "totale", atteso: 400, trovato: 345.94 }]);
  assert.deepEqual(controlloDocumento({ imponibile: null, iva: null, totale: 10 }, righe), []);
  assert.deepEqual(controlloDocumento({ imponibile: 100, iva: null, totale: 100 }, []), []);
  assert.deepEqual(controlloDocumento({ imponibile: 100, iva: 8.1, totale: 108.1 }, [{ totale_riga: 100 }, { totale_riga: null }]), []);
});

test("motivoConfronto e revisione", () => {
  assert.equal(motivoConfronto("confrontato", true), null);
  assert.match(motivoConfronto("primo_acquisto", false)!, /catalogo/);
  assert.match(motivoConfronto("unita_non_confrontabile", true)!, /unità diversa/);
  assert.match(motivoConfronto("valuta_diversa", true)!, /valuta/);
  assert.equal(revisione({ stato: "elaborazione", n_da_validare: 2, n_rincari_aperti: 0 }), null);
  assert.deepEqual(revisione({ stato: "completato", n_da_validare: 0, n_rincari_aperti: 0 }), { verificato: true, dettaglio: "" });
  assert.deepEqual(revisione({ stato: "completato", n_da_validare: 3, n_rincari_aperti: 1 }),
    { verificato: false, dettaglio: "3 articoli da validare · 1 rincaro da gestire" });
});

test("controlloFile: PDF protetti o danneggiati, XML non valido, p7m, file vuoto", () => {
  const b = new Uint8Array([1]);
  assert.equal(controlloFile("a.pdf", b, "%PDF-1.7\n1 0 obj"), null);
  assert.match(controlloFile("a.pdf", b, "PK\u0003\u0004")!, /non è un PDF/);
  assert.match(controlloFile("a.pdf", b, "%PDF-1.7 trailer << /Encrypt 5 0 R >>")!, /protetto/);
  assert.equal(controlloFile("a.xml", b, "﻿<?xml version=\"1.0\"?><p:FatturaElettronica/>"), null);
  assert.match(controlloFile("a.xml", b, "non xml")!, /XML valido/);
  assert.match(controlloFile("fattura.xml.p7m", b, "0\u0082")!, /p7m/);
  assert.match(controlloFile("a.jpg", new Uint8Array(), "")!, /vuoto/);
  assert.equal(controlloFile("a.jpg", b, "ÿØ"), null);
});
