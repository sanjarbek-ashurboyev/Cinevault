from django.urls import path

from accounts.views import (
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    PasswordResetConfirmAPIView,
    PasswordResetRequestAPIView,
    ProfileAPIView,
    RegisterCreateAPIView,
    ResendVerificationAPIView,
    VerifyEmailAPIView,
)

urlpatterns = [
    path('auth/register', RegisterCreateAPIView.as_view()),
    path('auth/verify-email', VerifyEmailAPIView.as_view()),
    path('auth/resend-verification', ResendVerificationAPIView.as_view()),
    path('auth/me', ProfileAPIView.as_view()),
    path('auth/password-reset/', PasswordResetRequestAPIView.as_view()),
    path('auth/password-reset-confirm/', PasswordResetConfirmAPIView.as_view(), name='password-reset-confirm'),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', CustomTokenRefreshView.as_view(), name='token_refresh'),
]