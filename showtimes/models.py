from django.db import models
from django.db.models import Model, ForeignKey, CASCADE
from django.db.models.fields import DateTimeField, DecimalField


# Create your models here.
class Showtime(Model):
    movie = ForeignKey('movies.Movie', on_delete=CASCADE, related_name='showtimes')
    hall = ForeignKey('halls.Hall', on_delete=CASCADE, related_name='showtimes')
    start_time = DateTimeField()
    end_time = DateTimeField()
    price = DecimalField(max_digits=12, decimal_places=0)

    def __str__(self):
        return f"{self.movie.title} @ {self.start_time.strftime('%Y-%m-%d %H:%M')} ({self.hall.name})"


