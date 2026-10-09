# payments/tasks.py
import logging

import stripe
from celery import shared_task
from django.conf import settings

from .models import Payment

logger = logging.getLogger(__name__)

# Worth asking again: the network, Stripe being busy or briefly down, or the same
# refund already in flight from another worker (Stripe answers that with a 409).
TRANSIENT_ERRORS = (
    stripe.error.APIConnectionError,
    stripe.error.RateLimitError,
    stripe.error.APIError,
    stripe.error.IdempotencyError,
)


def refund_idempotency_key(payment):
    # One key per intent: however many times this runs, Stripe makes one refund.
    return f"cinevault-refund-{payment.stripe_payment_intent_id}"


def _finish(payment, status, refund_id=""):
    # Only from "refunding", so a run that lost a race can't overwrite the winner.
    Payment.objects.filter(pk=payment.pk, status="refunding").update(status=status, stripe_refund_id=refund_id)


@shared_task(bind=True, max_retries=10)
def refund_late_payment(self, payment_id):
    """Give back a payment that arrived after its reservation's seats were released."""
    payment = Payment.objects.filter(pk=payment_id).first()
    if payment is None or payment.status != "refunding":
        return

    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        refund = stripe.Refund.create(
            payment_intent=payment.stripe_payment_intent_id,
            metadata={"reservation_id": str(payment.reservation_id)},
            idempotency_key=refund_idempotency_key(payment),
        )
    except TRANSIENT_ERRORS as exc:
        if self.request.retries >= self.max_retries:
            logger.error("Refund for payment %s still failing after %s tries: %s. "
                         "Run `manage.py refund_late_payments` to try again.",
                         payment.id, self.request.retries + 1, exc)
            _finish(payment, "refund_failed")
            return
        # 1, 2, 4 … minutes, capped at an hour: about six hours in all.
        raise self.retry(exc=exc, countdown=min(60 * 2 ** self.request.retries, 3600)) from exc
    except stripe.error.InvalidRequestError as exc:
        if exc.code == "charge_already_refunded":
            # Refunded already, from the Stripe dashboard say. The money is back either way.
            _finish(payment, "refunded")
            return
        logger.error("Stripe refused the refund for payment %s: %s", payment.id, exc)
        _finish(payment, "refund_failed")
        return
    except stripe.error.StripeError as exc:
        # A bad API key or missing permission: retrying won't help until someone fixes it.
        logger.error("Refund for payment %s failed: %s", payment.id, exc)
        _finish(payment, "refund_failed")
        return

    _finish(payment, "refunded", refund.id)
    logger.info("Refunded payment %s (%s) for cancelled reservation %s",
                payment.id, refund.id, payment.reservation_id)
