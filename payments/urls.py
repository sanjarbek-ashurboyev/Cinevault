from django.urls import path

from payments.views import CreatePaymentIntentView, stripe_webhook

urlpatterns = [
    path("payments/create-intent/<int:reservation_id>/", CreatePaymentIntentView.as_view()),
    path("payments/webhook/", stripe_webhook),
]