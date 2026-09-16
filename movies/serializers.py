from rest_framework.relations import PrimaryKeyRelatedField
from rest_framework.serializers import ModelSerializer

from movies.models import Movie, Genre


class GenreSerializer(ModelSerializer):
    class Meta:
        model = Genre
        fields = ['id', 'name']


class MovieSerializer(ModelSerializer):
    genres = PrimaryKeyRelatedField(many=True, queryset=Genre.objects.all())

    class Meta:
        model = Movie
        fields = [
            'id', 'title', 'description', 'poster', 'backdrop', 'trailer_url',
            'duration_minutes', 'genres', 'release_date', 'age_rating', 'rating', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        rep['genres'] = GenreSerializer(instance.genres.all(), many=True).data
        return rep