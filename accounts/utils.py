import secrets

from django.conf import settings
from django.core.cache import cache
from redis import Redis

redis_client = Redis.from_url(
    f'{settings.REDIS_URL}/3',
    decode_responses=True,
)

# A 6-digit code has a million values; capping guesses per code and codes per hour
# keeps it from being brute-forced.
MAX_CODE_ATTEMPTS = 5
MAX_CODES_PER_HOUR = 5


def generate_code():
    """A 6-digit one-time code. `secrets`, not `random`: these must be unpredictable."""
    return f'{secrets.randbelow(1_000_000):06d}'


def _count(key, timeout):
    cache.add(key, 0, timeout)
    try:
        return cache.incr(key)
    except ValueError:  # expired between add and incr
        cache.set(key, 1, timeout)
        return 1


def failed_attempt_limit_reached(purpose, ident, timeout=600):
    """Record a wrong code; True once this code has had MAX_CODE_ATTEMPTS wrong guesses."""
    return _count(f'code_attempts:{purpose}:{ident}', timeout) >= MAX_CODE_ATTEMPTS


def reset_failed_attempts(purpose, ident):
    cache.delete(f'code_attempts:{purpose}:{ident}')


def code_request_allowed(purpose, email):
    """False once MAX_CODES_PER_HOUR codes have been sent to this address this hour."""
    return _count(f'code_requests:{purpose}:{email.lower()}', 3600) <= MAX_CODES_PER_HOUR
