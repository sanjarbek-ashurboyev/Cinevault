#!/bin/sh
# Runs before every container's command — web and worker alike.
#
# set -e so a failed migration stops the container instead of starting
# gunicorn against a half-migrated database and serving 500s.
set -e

# Postgres accepts TCP connections a moment before it is ready to answer
# queries, and compose's depends_on only guarantees the container started.
# Without this wait the first deploy races the database and crash-loops.
if [ "${DB_ENGINE:-postgres}" != "sqlite" ]; then
    echo "entrypoint: waiting for postgres at ${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}"
    until python -c "
import os, sys, psycopg
try:
    psycopg.connect(
        dbname=os.environ.get('POSTGRES_DB', 'cinevault'),
        user=os.environ.get('POSTGRES_USER', 'cinevault'),
        password=os.environ['POSTGRES_PASSWORD'],
        host=os.environ.get('POSTGRES_HOST', 'db'),
        port=os.environ.get('POSTGRES_PORT', '5432'),
        connect_timeout=3,
    ).close()
except Exception as exc:
    print(exc, file=sys.stderr)
    sys.exit(1)
" 2>/dev/null; do
        sleep 1
    done
    echo "entrypoint: postgres is ready"
fi

# Only the web container does this. Two containers running `migrate` at
# once is how you get a half-applied schema — Django takes a lock per
# migration, not for the whole run, so the loser can apply operations out
# of order against a table the winner has already changed.
if [ "${RUN_DJANGO_SETUP:-0}" = "1" ]; then
    echo "entrypoint: applying migrations"
    python manage.py migrate --noinput

    # Admin and DRF assets into the volume nginx serves. Not the
    # hand-written frontend/, which nginx reads from its own mount.
    echo "entrypoint: collecting static files"
    python manage.py collectstatic --noinput --clear
fi

# exec, not a plain call: gunicorn replaces the shell as PID 1 and so
# receives Docker's SIGTERM directly. Otherwise the shell swallows it and
# every deploy ends in a 10-second timeout and a SIGKILL mid-request.
exec "$@"
