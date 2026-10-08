from django.db.models import (
    CharField,
    DateField,
    DateTimeField,
    DecimalField,
    ImageField,
    ManyToManyField,
    Model,
    PositiveIntegerField,
    TextChoices,
    TextField,
    URLField,
)


# Create your models here.
class Genre(Model):
    name = CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


class Movie(Model):
    class AgeRating(TextChoices):
        G = 'G', 'General'
        PG = 'PG', 'Parental Guidance'
        PG13 = 'PG-13', 'Parents Strongly Cautioned'
        R = 'R', 'Restricted'
        NC17 = 'NC-17', 'Adults Only'

    title = CharField(max_length=255)
    description = TextField()
    poster = ImageField(upload_to='movie_posters/', blank=True, null=True)
    # Landscape key art, as distinct from the portrait poster above. A poster
    # cropped to a wide hero banner is mostly a close-up of somebody's chin,
    # so anywhere the film is shown wide wants this instead.
    backdrop = ImageField(upload_to='movie_backdrops/', blank=True, null=True)
    trailer_url = URLField(blank=True)
    duration_minutes = PositiveIntegerField()
    genres = ManyToManyField('movies.Genre')
    release_date = DateField()
    age_rating = CharField(max_length=10, choices=AgeRating)
    rating = DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-release_date']

    def __str__(self):
        return self.title

