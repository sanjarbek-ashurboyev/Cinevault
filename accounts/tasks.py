import logging

from celery import shared_task
from django.core.mail import send_mail as django_send_mail

logger = logging.getLogger(__name__)

# shared_task, not a second Celery('email') app with its own broker. The
# old module built one hardcoded to redis://localhost:6379/0, which meant
# the producer published to a broker that only exists on a developer's
# laptop: off localhost, register and password-reset both 500 before the
# user is ever told their account was created.
#
# Mail goes through Django's backend rather than a raw smtplib call to
# smtp.gmail.com, so host, port, TLS and credentials all come from the
# EMAIL_* settings and swapping Gmail for a transactional provider is a
# change to .env instead of a change to this file.

RETRY_BACKOFF = 10
MAX_RETRIES = 3


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=RETRY_BACKOFF,
             retry_kwargs={'max_retries': MAX_RETRIES}, retry_jitter=True)
def send_mail(self, receiver_mail, otp_code):
    """Email a signup verification code.

    Retried because a refused SMTP connection is usually transient, and
    the alternative is a user sitting on a verification screen waiting
    for a code that was silently dropped. After the last attempt it is
    logged rather than swallowed — the code expires anyway, and the user
    can ask for another.
    """
    try:
        django_send_mail(
            subject='Your CineVault verification code',
            message=f'code : {otp_code}',
            from_email=None,  # falls back to DEFAULT_FROM_EMAIL
            recipient_list=[receiver_mail],
            fail_silently=False,
        )
    except Exception:
        if self.request.retries >= MAX_RETRIES:
            logger.exception('Gave up sending the verification code to %s', receiver_mail)
        raise


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=RETRY_BACKOFF,
             retry_kwargs={'max_retries': MAX_RETRIES}, retry_jitter=True)
def send_password_reset_email(self, receiver_mail, otp_code):
    """Email a password-reset code.

    The code is stored in Redis with a 600-second TTL, so the retries are
    deliberately short: a message delivered after that window arrives
    with a code the user can no longer use.
    """
    try:
        django_send_mail(
            subject='Password reset code',
            message=f'Your password reset code is : {otp_code}',
            from_email=None,
            recipient_list=[receiver_mail],
            fail_silently=False,
        )
    except Exception:
        if self.request.retries >= MAX_RETRIES:
            logger.exception('Gave up sending the password reset code to %s', receiver_mail)
        raise
