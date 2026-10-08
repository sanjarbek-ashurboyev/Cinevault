from django.test import TestCase
from rest_framework.test import APIClient

from movies.models import Genre, Movie
from test_helpers import client_for, make_movie, make_showtime, make_user


class MovieCatalogueTests(TestCase):
    def setUp(self):
        self.movie = make_showtime().movie

    def test_anyone_can_browse_movies(self):
        response = APIClient().get('/api/v1/movies/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([m['title'] for m in response.data['results']], ['Test Film'])

    def test_title_search(self):
        Movie.objects.create(title='Another One', description='.', duration_minutes=90,
                             release_date=self.movie.release_date, age_rating=Movie.AgeRating.G)
        response = APIClient().get('/api/v1/movies/', {'title': 'anoth'})
        self.assertEqual([m['title'] for m in response.data['results']], ['Another One'])

    def test_regular_users_cannot_edit_or_delete_movies(self):
        client = client_for(make_user())
        self.assertEqual(client.patch(f'/api/v1/movies/{self.movie.id}', {'title': 'X'}).status_code, 403)
        self.assertEqual(client.delete(f'/api/v1/movies/{self.movie.id}').status_code, 403)
        self.assertTrue(Movie.objects.filter(title='Test Film').exists())

    def test_superuser_can_delete_movies(self):
        admin = make_user(email='admin@example.com', is_superuser=True, is_staff=True)
        self.assertEqual(client_for(admin).delete(f'/api/v1/movies/{self.movie.id}').status_code, 204)


class MovieListQueryTests(TestCase):
    URL = '/api/v1/movies/'

    def test_query_count_does_not_grow_with_the_number_of_movies(self):
        # One page count, one page of movies, one batch of genres: never one query per movie.
        genres = [Genre.objects.create(name='Drama'), Genre.objects.create(name='Comedy')]
        make_movie('First', genres)
        with self.assertNumQueries(3):
            self.client.get(self.URL)

        for n in range(15):
            make_movie(f'Movie {n}', genres)
        with self.assertNumQueries(3):
            response = self.client.get(self.URL)
        self.assertEqual(len(response.data['results']), 16)
        self.assertEqual(response.data['results'][0]['genres'][0].keys(), {'id', 'name'})

    def test_detail_fetches_genres_in_one_query(self):
        movie = make_movie(genres=[Genre.objects.create(name='Drama')])
        with self.assertNumQueries(2):
            self.client.get(f'{self.URL}{movie.id}')


class PaginationTests(TestCase):
    URL = '/api/v1/movies/'

    def setUp(self):
        for n in range(25):
            make_movie(f'Movie {n}')

    def test_lists_return_20_rows_a_page_with_a_link_to_the_next(self):
        response = APIClient().get(self.URL)

        self.assertEqual(response.data['count'], 25)
        self.assertEqual(len(response.data['results']), 20)
        self.assertIsNotNone(response.data['next'])
        second = APIClient().get(self.URL, {'page': 2})
        self.assertEqual(len(second.data['results']), 5)
        self.assertIsNone(second.data['next'])

    def test_pages_do_not_overlap(self):
        first = APIClient().get(self.URL).data['results']
        second = APIClient().get(self.URL, {'page': 2}).data['results']
        ids = [m['id'] for m in first + second]
        self.assertEqual(len(ids), len(set(ids)), 'a stable order means no movie appears twice')

    def test_page_size_can_be_raised_to_100_and_no_further(self):
        self.assertEqual(len(APIClient().get(self.URL, {'page_size': 100}).data['results']), 25)
        for n in range(80):
            make_movie(f'Extra {n}')
        self.assertEqual(len(APIClient().get(self.URL, {'page_size': 500}).data['results']), 100)
