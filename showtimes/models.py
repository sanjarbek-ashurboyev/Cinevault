from django.db.models import CASCADE, CheckConstraint, F, ForeignKey, Model, Q
from django.db.models.fields import DateTimeField, DecimalField

# PostgreSQL-only exclusion constraint, added in migration 0002: one hall, one film at a time.
NO_OVERLAP_CONSTRAINT = 'showtime_no_overlap_in_hall'


class Showtime(Model):
    movie = ForeignKey('movies.Movie', on_delete=CASCADE, related_name='showtimes')
    hall = ForeignKey('halls.Hall', on_delete=CASCADE, related_name='showtimes')
    start_time = DateTimeField()
    end_time = DateTimeField()
    price = DecimalField(max_digits=12, decimal_places=0)

    class Meta:
        constraints = [
            CheckConstraint(condition=Q(end_time__gt=F('start_time')), name='showtime_ends_after_start'),
        ]

    def __str__(self):
        return f"{self.movie.title} @ {self.start_time.strftime('%Y-%m-%d %H:%M')} ({self.hall.name})"
