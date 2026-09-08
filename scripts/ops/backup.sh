#!/usr/bin/env bash
# =============================================================================
# Edit Kit Management System - backup
# =============================================================================
# Takes one consistent backup of the two things that hold the system's record:
#
#   1. the PostgreSQL database          -> database.dump   (pg_dump custom format)
#   2. the storage directory            -> storage.tar.gz  (signatures, photos)
#
# and writes a manifest with a SHA-256 of each so a restore can prove it has
# the same bytes. The dump is taken first and the storage second; a signature
# row whose file is missing is handled by the application (the document still
# renders, the box reads "signature on file"), the reverse is a file nobody
# refers to, so this order errs towards keeping every row.
#
# Usage:
#   DATABASE_URL=postgresql://... STORAGE_LOCAL_PATH=./storage \
#     scripts/ops/backup.sh [destination-dir]
#
# Defaults: destination ./backups/<UTC timestamp>, STORAGE_LOCAL_PATH ./storage.
# Requires pg_dump 16 on PATH (the server's major version), tar, sha256sum.
# Read-only against the database: safe to run while the application is up.
# =============================================================================
set -euo pipefail

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
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${1:-./backups/${STAMP}}"

for tool in pg_dump tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not on PATH." >&2; exit 2; }
done

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

echo "Backing up to $DEST"

# --- 1. Database ---------------------------------------------------------------
# Custom format: compressed, restorable table-by-table, and pg_restore can list
# it. --no-owner / --no-privileges so it restores under whatever role the
# target uses.
pg_dump --dbname="$PG_URL" --format=custom --compress=6 --no-owner --no-privileges \
  --file="$DEST/database.dump"
echo "  database.dump   $(du -h "$DEST/database.dump" | cut -f1)"

# Which migrations the dump contains, so a restore can be checked against the
# code it is restored under.
psql "$PG_URL" --no-align --tuples-only --quiet \
  --command='SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name' \
  > "$DEST/migrations.txt" 2>/dev/null || echo "(psql unavailable; migration list skipped)" > "$DEST/migrations.txt"

# --- 2. Storage ----------------------------------------------------------------
if [[ -d "$STORAGE" ]]; then
  tar --create --gzip --file="$DEST/storage.tar.gz" --directory="$STORAGE" .
  echo "  storage.tar.gz  $(du -h "$DEST/storage.tar.gz" | cut -f1)  ($(find "$STORAGE" -type f | wc -l | tr -d ' ') files)"
else
  echo "  storage: $STORAGE does not exist; nothing to archive" >&2
  tar --create --gzip --file="$DEST/storage.tar.gz" --files-from=/dev/null
fi

# --- 3. Manifest ---------------------------------------------------------------
(
  cd "$DEST"
  sha256sum database.dump storage.tar.gz migrations.txt > SHA256SUMS
  {
    echo "created_utc=$STAMP"
    echo "database_host=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^/?]+).*#\2#')"
    echo "database_name=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^/]+/([^?]+).*#\1#')"
    echo "storage_path=$STORAGE"
    echo "pg_dump_version=$(pg_dump --version | awk '{print $3}')"
    echo "migrations=$(wc -l < migrations.txt | tr -d ' ')"
  } > MANIFEST
)

echo "  SHA256SUMS      written"
echo "Done."
