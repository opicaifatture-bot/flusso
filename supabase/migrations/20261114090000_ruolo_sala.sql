-- Sala · 0 — ruolo per i camerieri (file separato: il nuovo valore dell'enum
-- non è utilizzabile nella stessa transazione in cui viene aggiunto).
alter type public.ruolo_membro add value if not exists 'sala';
