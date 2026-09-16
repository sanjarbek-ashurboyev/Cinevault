from redis import Redis
from django.conf import settings

redis_client = Redis.from_url(
    f'{settings.REDIS_URL}/3',
    decode_responses=True,
)
