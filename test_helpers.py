"""Shared builders for the test suite."""
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from halls.models import Hall, Seat
from movies.models import Movie
from showtimes.models import Showtime


def make_user(email='user@example.com', verified=True, **extra):
    return User.objects.create_user(email=email, password='Str0ng-pass!', is_verified=verified, **extra)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def make_hall(name='Hall 1', rows=2, per_row=3):
    hall = Hall.objects.create(name=name, total_rows=rows, total_seats_per_row=per_row)
    Seat.objects.bulk_create(
        Seat(hall=hall, row=r, number=n) for r in range(1, rows + 1) for n in range(1, per_row + 1)
    )
    return hall


def make_showtime(hall=None, price=20, starts_in=timedelta(days=1)):
    hall = hall or make_hall()
    movie = Movie.objects.create(
        title='Test Film', description='A film.', duration_minutes=120,
        release_date=date(2026, 1, 1), age_rating=Movie.AgeRating.PG13,
    )
    start = timezone.now() + starts_in
    return Showtime.objects.create(
        movie=movie, hall=hall, start_time=start, end_time=start + timedelta(hours=2), price=price,
    )


class FakeRedis:
    """The few redis-py calls accounts/ uses, backed by a dict."""

    def __init__(self):
        self.data = {}

    def setex(self, key, ttl, value):
        self.data[key] = str(value)

    def get(self, key):
        return self.data.get(key)

    def delete(self, key):
        self.data.pop(key, None)
