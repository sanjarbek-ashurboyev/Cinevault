from django.test import TestCase
from rest_framework.test import APIClient

from movies.models import Movie
from test_helpers import client_for, make_showtime, make_user


class MovieCatalogueTests(TestCase):
    def setUp(self):
        self.movie = make_showtime().movie

    def test_anyone_can_browse_movies(self):
        response = APIClient().get('/api/v1/movies/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([m['title'] for m in response.data], ['Test Film'])

    def test_title_search(self):
        Movie.objects.create(title='Another One', description='.', duration_minutes=90,
                             release_date=self.movie.release_date, age_rating=Movie.AgeRating.G)
        response = APIClient().get('/api/v1/movies/', {'title': 'anoth'})
        self.assertEqual([m['title'] for m in response.data], ['Another One'])

    def test_regular_users_cannot_edit_or_delete_movies(self):
        client = client_for(make_user())
        self.assertEqual(client.patch(f'/api/v1/movies/{self.movie.id}', {'title': 'X'}).status_code, 403)
        self.assertEqual(client.delete(f'/api/v1/movies/{self.movie.id}').status_code, 403)
        self.assertTrue(Movie.objects.filter(title='Test Film').exists())

    def test_superuser_can_delete_movies(self):
        admin = make_user(email='admin@example.com', is_superuser=True, is_staff=True)
        self.assertEqual(client_for(admin).delete(f'/api/v1/movies/{self.movie.id}').status_code, 204)
