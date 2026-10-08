from django.db.models import CASCADE, ForeignKey, Model
from django.db.models.fields import CharField, PositiveSmallIntegerField


# Create your models here.
class Hall(Model):
    name = CharField(max_length=20)
    total_rows = PositiveSmallIntegerField()
    total_seats_per_row = PositiveSmallIntegerField()

    def __str__(self):
        return self.name

    def generate_seats(self):
        seats = [
            Seat(hall=self, row=row, number=number)
            for row in range(1, self.total_rows + 1)
            for number in range(1, self.total_seats_per_row + 1)
        ]
        Seat.objects.bulk_create(seats, ignore_conflicts=True)


class Seat(Model):
    hall = ForeignKey('halls.Hall', on_delete=CASCADE, related_name='seats')
    row = PositiveSmallIntegerField()
    number = PositiveSmallIntegerField()

    class Meta:
        unique_together = ('hall', 'row', 'number')

    @property
    def label(self):
        """The seat as an audience member reads it: row 1 seat 3 is "A3".

        Rows are stored as numbers but signposted in the auditorium with
        letters, so this is what belongs on a ticket and on the seat map.
        Halls deeper than 26 rows fall back to the bare number rather than
        inventing a second letter.
        """
        if 1 <= self.row <= 26:
            return f"{chr(64 + self.row)}{self.number}"
        return f"{self.row}-{self.number}"

    def __str__(self):
        return f"{self.hall.name} - Row {self.row}, Seat {self.number}"
