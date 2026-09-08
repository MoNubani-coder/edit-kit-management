#!/usr/bin/env bash
# =============================================================================
# Edit Kit Management System - restore
# =============================================================================
# Restores a backup taken by scripts/ops/backup.sh into an EMPTY database and
# an empty storage directory, then proves it: checksums first, row counts and
# the migration list after.
#
# Usage:
#   DATABASE_URL=postgresql://... STORAGE_LOCAL_PATH=./storage \
#     scripts/ops/restore.sh <backup-dir> [--yes]
#
# Refuses to restore into a database that already has tables unless --yes is
# given, because a restore is the one operation that can silently replace the
# record. Stop the application first: an open session mid-restore sees a
# database that is partly yesterday's.
# Requires pg_restore 16 on PATH, psql, tar, sha256sum.
# =============================================================================
set -euo pipefail

SRC="${1:-}"
CONFIRM="${2:-}"

if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "Usage: restore.sh <backup-dir> [--yes]" >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 2
fi

# Prisma's DATABASE_URL carries parameters libpq does not know - `schema` above
# all - and pg_dump refuses the whole URI because of them. Keep only what
# libpq understands.
libpq_url() {
  local url="$1" base query kept=""
  base="${url%%\?*}"
  query="${url#*\?}"
  [[ "$query" == "$url" ]] && { printf '%s' "$base"; return; }
  local IFS='&' pair
  for pair in $query; do
    case "${pair%%=*}" in
      sslmode|sslcert|sslkey|sslrootcert|sslpassword|application_name|connect_timeout|options|target_session_attrs)
        kept="${kept:+$kept&}$pair"
        ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

STORAGE="${STORAGE_LOCAL_PATH:-./storage}"

PG_URL="$(libpq_url "$DATABASE_URL")"

for tool in pg_restore psql tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not on PATH." >&2; exit 2; }
done

SRC="$(cd "$SRC" && pwd)"
echo "Restoring from $SRC"

# --- 0. Prove the backup is the backup -----------------------------------------
(cd "$SRC" && sha256sum --check --quiet SHA256SUMS) || { echo "Checksums do not match. Refusing to restore altered files." >&2; exit 1; }
echo "  checksums       verified"

# --- 1. Refuse to overwrite a live database by accident -----------------------
existing="$(psql "$PG_URL" --no-align --tuples-only --quiet \
  --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [[ "$existing" != "0" && "$CONFIRM" != "--yes" ]]; then
  echo "The target database already has $existing tables. Re-run with --yes to drop and replace them." >&2
  exit 1
fi

# --- 2. Database ---------------------------------------------------------------
# --clean --if-exists drops what the dump is about to recreate; --single-transaction
# means a failure leaves the target as it was. --no-owner / --no-privileges match
# the way the dump was taken.
pg_restore --dbname="$PG_URL" --clean --if-exists --single-transaction \
  --no-owner --no-privileges --exit-on-error "$SRC/database.dump"
echo "  database        restored"

# --- 3. Storage ----------------------------------------------------------------
mkdir -p "$STORAGE"
if [[ -n "$(ls -A "$STORAGE" 2>/dev/null)" && "$CONFIRM" != "--yes" ]]; then
  echo "$STORAGE is not empty. Re-run with --yes to restore over it." >&2
  exit 1
fi
tar --extract --gzip --file="$SRC/storage.tar.gz" --directory="$STORAGE"
echo "  storage         $(find "$STORAGE" -type f | wc -l | tr -d ' ') files"

# --- 4. Prove it ---------------------------------------------------------------
psql "$PG_URL" --no-align --tuples-only --quiet --command="
  SELECT 'bookings=' || count(*) FROM bookings
  UNION ALL SELECT 'inspections=' || count(*) FROM inspections
  UNION ALL SELECT 'signatures=' || count(*) FROM signatures
  UNION ALL SELECT 'assets=' || count(*) FROM assets
  UNION ALL SELECT 'audit_logs=' || count(*) FROM audit_logs
  UNION ALL SELECT 'users=' || count(*) FROM users" | sed 's/^/  /'

restored_migrations="$(psql "$PG_URL" --no-align --tuples-only --quiet \
  --command='SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name')"
if [[ "$restored_migrations" == "$(cat "$SRC/migrations.txt")" ]]; then
  echo "  migrations      $(wc -l < "$SRC/migrations.txt" | tr -d ' ') applied, matching the backup"
else
  echo "  migrations      DIFFER from the backup's list; run 'npx prisma migrate status' before starting the application" >&2
fi

echo "Done. Start the application, sign in, and open the most recent booking's signed document."
