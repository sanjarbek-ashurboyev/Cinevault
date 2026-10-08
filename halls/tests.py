from django.test import TestCase
from rest_framework.test import APIClient

from test_helpers import client_for, make_hall, make_user


class HallTests(TestCase):
    def setUp(self):
        self.hall = make_hall(rows=2, per_row=3)

    def test_anyone_can_list_halls(self):
        response = APIClient().get('/api/v1/halls/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)

    def test_raw_seat_list_is_for_superusers_only(self):
        # Customers see seats through the showtime seat map, which includes booking status.
        url = f'/api/v1/halls/{self.hall.id}/seats'
        self.assertEqual(APIClient().get(url).status_code, 401)
        self.assertEqual(client_for(make_user()).get(url).status_code, 403)

        admin = make_user(email='admin@example.com', is_superuser=True, is_staff=True)
        self.assertEqual(len(client_for(admin).get(url).data['results']), 6)
