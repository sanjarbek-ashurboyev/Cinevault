from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, EmailField
from rest_framework.serializers import ModelSerializer, Serializer
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from accounts.utils import failed_attempt_limit_reached, redis_client, reset_failed_attempts


class RegisterSerializer(ModelSerializer):
    confirm_password = CharField(max_length=100, write_only=True)

    class Meta:
        model = User
        fields = 'first_name', 'last_name', 'email', 'password', 'confirm_password'
        extra_kwargs = {
            'password': {'write_only': True},
        }

    def validate(self, attrs):
        if attrs['password'] != attrs['confirm_password']:
            raise ValidationError({'confirm_password': "Passwords don't match"})
        return attrs


    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise ValidationError('This email is already registered')
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        validated_data.pop('confirm_password')
        user = User.objects.create_user(
            email=validated_data['email'],
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', ''),
            password=validated_data['password'],
        )
        return user


class VerifyEmailSerializer(Serializer):
    email = EmailField()
    code = CharField(max_length=6)

    def validate(self, attrs):
        email = attrs['email']
        code = attrs['code']

        cached_code = cache.get(f'verify_code:{email}')
        if cached_code is None:
            raise ValidationError('Code expired or not found')
        if cached_code != code:
            if failed_attempt_limit_reached('verify', email):
                cache.delete(f'verify_code:{email}')
                reset_failed_attempts('verify', email)
                raise ValidationError('Too many wrong codes. Request a new code.')
            raise ValidationError('Invalid verification code')
        reset_failed_attempts('verify', email)

        attrs['user'] = User.objects.filter(email=email).first()
        if attrs['user'] is None:
            raise ValidationError('User not found')

        return attrs


class ResendVerificationSerializer(Serializer):
    email = EmailField()

    def validate_email(self, value):
        user = User.objects.filter(email=value).first()
        if user is None:
            raise ValidationError('User with this email does not exist')
        if user.is_verified:
            raise ValidationError('This email is already verified')
        return value


class LogoutSerializer(Serializer):
    refresh = CharField()

    def validate_refresh(self, value):
        try:
            self.token = RefreshToken(value)
        except TokenError:
            raise ValidationError('Invalid or expired refresh token')
        return value

    def save(self, **kwargs):
        try:
            self.token.blacklist()
        except TokenError:
            raise ValidationError('Token is already blacklisted')



class ProfileSerializer(ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'email', 'first_name', 'last_name', 'is_verified', 'date_joined')
        read_only_fields = ('id', 'email', 'is_verified', 'date_joined')


class PasswordResetRequestSerializer(Serializer):
    email = EmailField()


class PasswordResetConfirmSerializer(Serializer):
    email = EmailField()
    code = CharField(max_length=6)
    new_password = CharField(write_only=True)
    confirm_password = CharField(write_only=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise ValidationError({'confirm_password': "Passwords don't match"})

        user = User.objects.filter(email=attrs['email']).first()
        if user is None:
            raise ValidationError({'email': 'Invalid email or code'})

        stored_code = redis_client.get(f'password_reset:{user.id}')
        if stored_code is None:
            raise ValidationError({'code': 'Code expired or not found'})

        stored_code = stored_code.decode() if isinstance(stored_code, bytes) else stored_code
        if stored_code != attrs['code']:
            if failed_attempt_limit_reached('password_reset', user.id):
                redis_client.delete(f'password_reset:{user.id}')
                reset_failed_attempts('password_reset', user.id)
                raise ValidationError({'code': 'Too many wrong codes. Request a new code.'})
            raise ValidationError({'code': 'Invalid code'})

        validate_password(attrs['new_password'], user=user)

        attrs['user'] = user
        return attrs

    def save(self, **kwargs):
        user = self.validated_data['user']
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        redis_client.delete(f'password_reset:{user.id}')
        reset_failed_attempts('password_reset', user.id)
        return user


