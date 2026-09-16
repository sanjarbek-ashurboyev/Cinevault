import logging
import random

from django.core.cache import cache
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.generics import CreateAPIView, GenericAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts.models import User
from accounts.serializers import RegisterSerializer, VerifyEmailSerializer, ResendVerificationSerializer, \
    ProfileSerializer, PasswordResetRequestSerializer, PasswordResetConfirmSerializer
from accounts.tasks import send_mail, send_password_reset_email
from accounts.utils import redis_client

logger = logging.getLogger(__name__)

# How long an emailed verification code stays valid.
VERIFY_CODE_TTL = 600


# Create your views here.
@extend_schema(tags=['auth'])
class RegisterCreateAPIView(CreateAPIView):
    permission_classes = [AllowAny]
    serializer_class = RegisterSerializer

    def perform_create(self, serializer):
        with transaction.atomic():
            user = serializer.save()
            code = str(random.randint(100000, 999999))
            cache.set(f'verify_code:{user.email}', code, timeout=VERIFY_CODE_TTL)
            transaction.on_commit(lambda: self._queue_verification(user.email, code))

    @staticmethod
    def _queue_verification(email, code):
        try:
            send_mail.delay(email, code)
        except Exception:
            logger.exception(
                'Account for %s was created but its verification code could not be '
                'queued. The user must use resend-verification to receive one.',
                email,
            )


@extend_schema(tags=['auth'])
class VerifyEmailAPIView(GenericAPIView):
    serializer_class = VerifyEmailSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.is_verified = True
        user.save(update_fields=['is_verified'])
        cache.delete(f'verify_code:{user.email}')
        return Response({'detail': 'Email verified successfully'}, status=status.HTTP_200_OK)


@extend_schema(tags=['auth'])
class ResendVerificationAPIView(GenericAPIView):
    serializer_class = ResendVerificationSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']

        code = str(random.randint(100000, 999999))
        cache.set(f'verify_code:{email}', code, timeout=VERIFY_CODE_TTL)

        send_mail.delay(email, code)

        return Response({'detail': 'Verification code resent'}, status=status.HTTP_200_OK)


@extend_schema(tags=['auth'])
class CustomTokenObtainPairView(TokenObtainPairView):
    pass


@extend_schema(tags=['auth'])
class CustomTokenRefreshView(TokenRefreshView):
    pass


@extend_schema(tags=['auth'])
class ProfileAPIView(RetrieveUpdateAPIView):
    serializer_class = ProfileSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch']

    def get_object(self):
        return self.request.user


@extend_schema(tags=['auth'])
class PasswordResetRequestAPIView(GenericAPIView):
    serializer_class = PasswordResetRequestSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serialier = self.get_serializer(data=request.data)
        serialier.is_valid(raise_exception=True)
        email = serialier.validated_data['email']

        user = User.objects.filter(email=email).first()
        if user is not None:
            code = str(random.randint(100000, 999999))
            redis_client.setex(f'password_reset:{user.id}', 600, code)
            send_password_reset_email.delay(user.email, code)

        return Response(
            {'detail': 'If an account exists with this email, a reset code has been sent'},
            status=status.HTTP_200_OK,
        )



@extend_schema(tags=['auth'])
class PasswordResetConfirmAPIView(GenericAPIView):
    serializer_class = PasswordResetConfirmSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({'detail': 'Password reset successfully'}, status=status.HTTP_200_OK)



















