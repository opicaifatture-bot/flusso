-- Autocontrollo · 0 — due nuovi ruoli. In un file a parte perché un valore
-- aggiunto a un enum non è utilizzabile nella stessa transazione.
--  · consulente: consulente HACCP, vede e gestisce solo l'autocontrollo
--  · cucina: account condiviso del tablet di cucina; chi registra si identifica con un PIN personale
alter type public.ruolo_membro add value if not exists 'consulente';
alter type public.ruolo_membro add value if not exists 'cucina';
