# Deploying CineVault

Five containers behind one port. nginx is the only thing published; the
database, Redis and gunicorn are reachable only on the internal compose
network.

```
                         :80
                          │
                       ┌──▼────┐   /            → frontend/ (static files)
                       │ nginx │   /static/      → static volume
                       └──┬────┘   /media/       → media volume
                          │        /api/ /admin/ → proxied
                     ┌────▼────┐
                     │   web   │  gunicorn, 3 workers
                     └──┬───┬──┘
              ┌─────────┘   └────────┐
         ┌────▼───┐              ┌───▼───┐
         │   db   │              │ redis │◄──── worker (celery)
         │postgres│              │       │
         └────────┘              └───────┘
```

The frontend and the API share one origin, which is why
`frontend/js/config.js` uses relative paths and CORS is empty in
production.

## First deploy

1. **Install Docker** on the server, then copy the project across
   (`git clone`, or rsync — but never the `.env`).

2. **Write `.env`** from the template:

   ```sh
   cp .env.example .env
   python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # DJANGO_SECRET_KEY
   python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # POSTGRES_PASSWORD
   ```

   Set at minimum `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`,
   `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, the `EMAIL_*`
   block and the `STRIPE_*` block. Leave `DJANGO_SECURE_SSL_REDIRECT=False`
   and `DJANGO_HSTS_SECONDS=0` until TLS is actually working.

3. **Start it.** Migrations and `collectstatic` run automatically in the
   web container's entrypoint.

   ```sh
   docker compose up -d --build
   docker compose logs -f web
   ```

4. **Create an admin login and load the catalogue.**

   ```sh
   docker compose exec web python manage.py createsuperuser
   docker compose exec web python manage.py seed_cinema
   ```

   `seed_cinema` needs the poster images present first. They are not in
   git, so copy them into the media volume before seeding:

   ```sh
   docker compose cp ./media/. web:/app/media/
   ```

5. **Check it.**

   ```sh
   curl -sS http://<host>/api/health/          # {"status": "ok"}
   docker compose ps                           # db and redis healthy
   docker compose logs worker | grep ready     # celery@… ready
   ```

## TLS

Nothing here terminates TLS yet — `docker/nginx.conf` listens on 80
only. Either put the stack behind something that already does (Caddy,
Cloudflare, a cloud load balancer), or add certbot and a `listen 443 ssl`
server block.

Once HTTPS is confirmed working, and only then:

```
DJANGO_SECURE_SSL_REDIRECT=True
DJANGO_HSTS_SECONDS=31536000
```

Raise HSTS last. A browser that has seen the header refuses plain HTTP to
the domain for the full duration and cannot be told to forget early, so a
year-long value set against a broken certificate takes the site down for
returning visitors with no way to undo it.

## Stripe

The webhook has to be reachable from Stripe's servers, which means a
public HTTPS URL:

```
https://<your-domain>/api/v1/payments/webhook/
```

Register that endpoint in the Stripe dashboard and put **its** signing
secret in `STRIPE_WEBHOOK_SECRET`. The secret printed by `stripe listen`
during local development is a different one and fails signature
verification here.

Going live also means replacing `STRIPE_PUBLISHABLE_KEY` in **two**
places: `.env`, and `frontend/js/config.js` — the browser reads that file
directly and nothing templates it.

If the worker is not running, payments still succeed but no ticket email
is ever sent and no unpaid seat hold is ever released. `docker compose ps`
is the check that matters after every deploy.

## Routine operations

```sh
docker compose logs -f web worker        # follow application logs
docker compose ps                        # health
docker compose restart worker            # after a task change
docker compose up -d --build             # deploy new code
docker compose exec web python manage.py shell
```

## Backups

The Postgres volume and the media volume are the only irreplaceable
state. Nothing below is scheduled — wire it into cron.

```sh
# database
docker compose exec -T db pg_dump -U cinevault cinevault | gzip > db-$(date +%F).sql.gz

# restore
gunzip -c db-2026-01-01.sql.gz | docker compose exec -T db psql -U cinevault -d cinevault

# uploaded posters
docker compose cp web:/app/media ./media-backup-$(date +%F)
```

Test the restore path before you need it.

## Local development

`.env` holds deployment values, so the Makefile overrides them for local
runs — SQLite, `DEBUG=True`, Swagger on. `make dev` works unchanged and
needs a Redis on localhost. Nothing about the container stack changes
when you edit `.env` for local work: `docker-compose.yml` pins
`DB_ENGINE`, `POSTGRES_HOST` and `REDIS_URL` for the containers
explicitly.
