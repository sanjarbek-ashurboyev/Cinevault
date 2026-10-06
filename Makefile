PY     := .venv/bin/python
CELERY := .venv/bin/celery
PIP    := .venv/bin/pip

HOST       := 127.0.0.1
PORT       := 8000
FRONT_PORT := 5500

# .env now holds deployment values — DEBUG off, Postgres on the compose
# network — because that is the file the server reads. These overrides put
# local runs back on SQLite with tracebacks on, without a second env file
# to keep in sync. load_dotenv does not overwrite an existing variable, so
# anything exported here wins over .env.
DEV_ENV := DJANGO_DEBUG=True \
           DB_ENGINE=sqlite \
           DJANGO_SECURE_SSL_REDIRECT=False \
           DJANGO_EXPOSE_API_DOCS=True \
           REDIS_URL=redis://127.0.0.1:6379

# must match the route in payments/urls.py
WEBHOOK_PATH := /api/v1/payments/webhook/

.DEFAULT_GOAL := help
.PHONY: help run celery front stripe dev mig migrate seed superuser shell check test clean

help: ## show this list
	@echo "CineVault — make targets:"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  dev runs all four at once. Redis must already be running."

# ── the three processes ────────────────────────────────────────

run: ## Django API on :8000
	$(DEV_ENV) $(PY) manage.py runserver $(HOST):$(PORT)

celery: ## Celery worker — ticket emails, seat-hold expiry, OTP mail
	$(DEV_ENV) $(CELERY) -A root worker --loglevel=info

# Goes through devserver.py rather than `python -m http.server` so that
# edited CSS and JS actually reach the browser: the stdlib server sends no
# Cache-Control, and Chrome then caches heuristically and serves a stale
# file with no request to show for it.
front: ## serve frontend/ on :5500 (override with FRONT_PORT=…)
	$(PY) devserver.py $(FRONT_PORT) --bind $(HOST) --directory frontend

# Stripe's servers cannot reach 127.0.0.1, so without this nothing ever
# tells Django a payment succeeded: the reservation stays pending, no
# ticket email goes out, and the 10-minute sweep cancels a booking the
# customer has already paid for.
stripe: ## forward Stripe webhooks to the local API (required for payments)
	stripe listen --forward-to localhost:$(PORT)$(WEBHOOK_PATH)

# Backgrounds all three in one shell and traps the exit, so a single
# Ctrl-C takes the whole group down instead of orphaning a worker that
# then keeps eating tasks in the background.
dev: ## run API + worker + frontend + Stripe listener (Ctrl-C stops all)
	@echo "API      http://$(HOST):$(PORT)"
	@echo "Frontend http://$(HOST):$(FRONT_PORT)"
	@echo "Swagger  http://$(HOST):$(PORT)/swagger/"
	@echo "Ctrl-C stops all four."
	@command -v stripe >/dev/null 2>&1 \
		|| echo "  ! stripe CLI not on PATH — payments will not confirm and no ticket emails will send"
	@echo
	@trap 'kill 0' EXIT INT TERM; \
		$(DEV_ENV) $(PY) manage.py runserver $(HOST):$(PORT) & \
		$(DEV_ENV) $(CELERY) -A root worker --loglevel=info & \
		$(PY) devserver.py $(FRONT_PORT) --bind $(HOST) --directory frontend & \
		stripe listen --forward-to localhost:$(PORT)$(WEBHOOK_PATH) & \
		wait

# ── database ───────────────────────────────────────────────────

mig: ## makemigrations + migrate
	$(DEV_ENV) $(PY) manage.py makemigrations
	$(DEV_ENV) $(PY) manage.py migrate

migrate: ## apply existing migrations only
	$(DEV_ENV) $(PY) manage.py migrate

# Wipes the catalogue and rebuilds it from movies/fixtures/catalog.json:
# real films with their studio trailers and poster art, six screens, and a
# schedule laid out from today. Regenerate whenever the listing looks stale —
# the dates are relative to the run, not baked into the fixture.
seed: ## load real films, halls and a fresh 10-day schedule (replaces existing)
	$(DEV_ENV) $(PY) manage.py seed_cinema

superuser: ## create an admin login
	$(DEV_ENV) $(PY) manage.py createsuperuser

shell: ## Django shell
	$(DEV_ENV) $(PY) manage.py shell

# ── housekeeping ───────────────────────────────────────────────

check: ## system checks + warn about un-generated migrations
	$(DEV_ENV) $(PY) manage.py check
	$(DEV_ENV) $(PY) manage.py makemigrations --check --dry-run

test: ## run the test suite (SQLite + in-memory cache, no Redis needed)
	$(PY) manage.py test --settings=root.settings_test

clean: ## delete __pycache__ directories and stray .pyc files
	find . -path ./.venv -prune -o -type d -name '__pycache__' -exec rm -rf {} +
	find . -path ./.venv -prune -o -type f -name '*.pyc' -delete
