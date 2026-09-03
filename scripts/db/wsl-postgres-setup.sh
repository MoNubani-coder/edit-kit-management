#!/usr/bin/env bash
# =============================================================================
# Local PostgreSQL 16 inside WSL - for developers without Docker Desktop.
# =============================================================================
# Run as root inside WSL:
#
#   wsl -u root -e bash /mnt/c/<path-to-repo>/scripts/db/wsl-postgres-setup.sh
#
# Idempotent. Creates the `ekms` role and database matching .env.example and
# makes PostgreSQL listen on localhost so Windows can reach it on port 5432.
#
# The role is SUPERUSER only so `prisma migrate` can run CREATE EXTENSION for
# btree_gist and pg_trgm. That is acceptable for a throwaway dev database and
# nothing else.
# =============================================================================
set -euo pipefail

DB_USER="${DB_USER:-ekms}"
DB_PASS="${DB_PASS:-ekms_local_dev}"
DB_NAME="${DB_NAME:-ekms}"

if ! command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL is not installed. Run: apt-get install -y postgresql-16 postgresql-contrib-16" >&2
  exit 1
fi

PG_VERSION="$(ls /etc/postgresql | sort -V | tail -1)"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"

# Listen on localhost (WSL2 forwards localhost ports to Windows automatically).
if ! grep -qE "^listen_addresses\s*=\s*'localhost'" "$PG_CONF"; then
  sed -i "s/^#\?listen_addresses\s*=.*/listen_addresses = 'localhost'/" "$PG_CONF"
fi

# Password auth for the dev role over TCP.
if ! grep -q "host    ${DB_NAME}" "$PG_HBA"; then
  echo "host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    scram-sha-256" >> "$PG_HBA"
  echo "host    ${DB_NAME}    ${DB_USER}    ::1/128         scram-sha-256" >> "$PG_HBA"
fi

service postgresql start >/dev/null 2>&1 || service postgresql restart

# Wait for the server to accept connections.
for _ in $(seq 1 20); do
  if su - postgres -c "pg_isready -q"; then break; fi
  sleep 0.5
done

su - postgres -c "psql -v ON_ERROR_STOP=1 -q" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'\"" | grep -q 1; then
  su - postgres -c "createdb -O ${DB_USER} ${DB_NAME}"
fi

service postgresql reload >/dev/null 2>&1 || true

echo "PostgreSQL ${PG_VERSION} ready."
echo "  database : ${DB_NAME}"
echo "  role     : ${DB_USER}"
echo "  url      : postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
su - postgres -c "psql -tAc 'SELECT version();'"
