#!/usr/bin/env bash
# Esegue tutte le migrazioni su un database PostgreSQL usa-e-getta e poi i test.
# Requisiti: PostgreSQL 15+ con l'estensione pg_trgm, raggiungibile con le
# variabili standard PGHOST / PGPORT / PGUSER (deve poter creare database e ruoli).
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/esegui.sh
set -euo pipefail
qui="$(cd "$(dirname "$0")" && pwd)"
db="price_guardian_test"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT

psql -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1

esegui() { psql -q -v ON_ERROR_STOP=1 -1 -d "$db" -f "$1" >/dev/null 2>"$tmp" || { echo "ERRORE in $1"; grep -v NOTICE "$tmp" | head -20; exit 1; }; }

esegui "$qui/00_ambiente.sql"
for m in "$qui"/../migrations/*.sql; do
  # pg_cron e pgvector non servono ai test: l'ambiente fornisce dei segnaposto.
  sed -e '/create extension if not exists pg_cron/d' -e '/create extension if not exists vector/d' \
      -e 's/extensions\.vector(384)/extensions.vector/g' -e '/using hnsw/d' -e 's/::vector /::extensions.vector /g' "$m" > "$tmp.sql"
  esegui "$tmp.sql"; rm -f "$tmp.sql"
done
esegui "$qui/10_strumenti.sql"
psql -d "$db" -f "$qui/20_test.sql" 2>&1 | grep -vE '^(NOTICE|WARNING|HINT)' | tee "$tmp"
grep -q 'TUTTI I TEST SUPERATI' "$tmp"
