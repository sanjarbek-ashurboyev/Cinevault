"""Settings for the test suite: no PostgreSQL, Redis, SMTP or Stripe needed.

    python manage.py test --settings=root.settings_test
"""
import os

# settings.py requires a secret key, and PostgreSQL credentials unless DB_ENGINE is sqlite.
os.environ.setdefault('DJANGO_SECRET_KEY', 'test-only-secret-key')
os.environ['DB_ENGINE'] = 'sqlite'

from root.settings import *  # noqa: E402,F401,F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# SQLite ignores row locks, so the concurrency tests only run against PostgreSQL:
#     TEST_DB=postgres POSTGRES_PASSWORD=... python manage.py test --settings=root.settings_test
if os.getenv('TEST_DB') == 'postgres':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('POSTGRES_DB', 'cinevault'),
            'USER': os.getenv('POSTGRES_USER', 'cinevault'),
            'PASSWORD': os.getenv('POSTGRES_PASSWORD', ''),
            'HOST': os.getenv('POSTGRES_HOST', 'localhost'),
            'PORT': os.getenv('POSTGRES_PORT', '5432'),
        }
    }

# Verification codes and seat locks live in the cache; locmem replaces Redis.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}

# A local .env may turn this on for production; the test client speaks plain HTTP.
SECURE_SSL_REDIRECT = False

EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

STRIPE_SECRET_KEY = 'sk_test_dummy'
STRIPE_WEBHOOK_SECRET = 'whsec_dummy'

# Fast hashing: the suite creates many users.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
