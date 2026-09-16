# reservations/tasks.py
import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from .models import Reservation

logger = logging.getLogger(__name__)


def _payment_has_settled(reservation):
    """Has this reservation actually been paid for?

    The local Payment row only knows what the webhook told it, and the
    webhook can be late, or never arrive at all — during local
    development it never arrives unless `stripe listen` is running. So
    when there is an intent on file, Stripe itself is asked. Cancelling a
    booking somebody has paid for is far worse than holding its seats a
    little longer, so Stripe is the tie-breaker, not our own table.
    """
    from payments.models import Payment

    payment = Payment.objects.filter(reservation=reservation).first()
    if payment is None:
        return False
    if payment.status == 'succeeded':
        return True
    if not payment.stripe_payment_intent_id:
        return False

    import stripe
    from django.conf import settings

    stripe.api_key = settings.STRIPE_SECRET_KEY
    intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
    return intent['status'] in ('succeeded', 'processing')


@shared_task(bind=True, max_retries=3, default_retry_delay=120)
def cancel_reservation_if_unpaid(self, reservation_id):
    try:
        reservation = Reservation.objects.get(id=reservation_id)
    except Reservation.DoesNotExist:
        return

    if reservation.status != Reservation.StatusType.PENDING:
        return

    try:
        settled = _payment_has_settled(reservation)
    except Exception as exc:
        # Could not reach Stripe. Holding the seats and asking again is
        # the safe failure: the alternative is cancelling a paid booking
        # because the network blinked.
        logger.warning(
            'Cannot confirm payment state for reservation %s (%s) — deferring cancellation',
            reservation_id, exc,
        )
        raise self.retry(exc=exc)

    if settled:
        logger.info(
            'Reservation %s is paid but still pending — the webhook has not landed. '
            'Leaving it alone rather than cancelling a paid booking.',
            reservation_id,
        )
        return

    # cancel() also releases the seat rows; leaving them behind would
    # keep the seats unbookable even though the hold has lapsed.
    reservation.cancel()


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=5,
    retry_jitter=True,
)
def send_reservation_ticket(self, reservation_id):
    try:
        reservation = (
            Reservation.objects
            .select_related('user', 'showtime__movie', 'showtime__hall')
            .prefetch_related('seats__seat')
            .get(id=reservation_id)
        )
    except Reservation.DoesNotExist:
        logger.warning('Ticket email skipped: reservation %s no longer exists', reservation_id)
        return

    if reservation.user is None or not reservation.user.email:
        logger.warning('Ticket email skipped: reservation %s has no recipient', reservation_id)
        return

    # answer is a refund, not a cheerful confirmation email.
    if not reservation.seats.exists():
        logger.error(
            'Ticket email refused: reservation %s holds no seats (cancelled after payment?)',
            reservation_id,
        )
        return

    if reservation.status != Reservation.StatusType.CONFIRMED:
        logger.error(
            'Ticket email refused: reservation %s is %s, not confirmed',
            reservation_id, reservation.status,
        )
        return

    showtime = reservation.showtime
    movie = showtime.movie
    hall = showtime.hall
    user = reservation.user

    seats = sorted(
        (rs.seat for rs in reservation.seats.all()),
        key=lambda s: (s.row, s.number),
    )

    start = timezone.localtime(showtime.start_time)

    context = {
        'reservation': reservation,
        'movie': movie,
        'hall': hall,
        'start_date': start.strftime('%A, %d %B %Y'),
        'start_time': start.strftime('%H:%M'),
        'timezone': start.strftime('%Z') or str(timezone.get_current_timezone()),
        'seat_labels': ', '.join(s.label for s in seats),
        'seat_count': len(seats),
        'total_price': f'${reservation.total_price}',
        'full_name': f'{user.first_name} {user.last_name}'.strip() or user.email,
        'email': user.email,
    }

    subject = f'Your CineVault ticket — {movie.title}, {start.strftime("%a %d %b %H:%M")}'

    from_email = settings.EMAIL_HOST_USER or settings.DEFAULT_FROM_EMAIL

    message = EmailMultiAlternatives(
        subject=subject,
        body=render_to_string('emails/reservation_ticket.txt', context),
        from_email=from_email,
        to=[user.email],
    )
    message.attach_alternative(
        render_to_string('emails/reservation_ticket.html', context),
        'text/html',
    )
    message.send(fail_silently=False)

    logger.info('Ticket email sent for reservation %s to %s', reservation_id, user.email)
