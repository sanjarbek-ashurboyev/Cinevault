from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from test_helpers import FakeRedis, make_user

REGISTER = '/api/v1/auth/register'
VERIFY = '/api/v1/auth/verify-email'
RESEND = '/api/v1/auth/resend-verification'
LOGIN = '/api/v1/auth/login/'
ME = '/api/v1/auth/me'
RESET = '/api/v1/auth/password-reset/'
RESET_CONFIRM = '/api/v1/auth/password-reset-confirm/'


@mock.patch('accounts.views.send_mail')
class RegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def register(self, **overrides):
        data = {'email': 'new@example.com', 'first_name': 'Ali', 'last_name': 'Valiyev',
                'password': 'Str0ng-pass!', 'confirm_password': 'Str0ng-pass!', **overrides}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(REGISTER, data, format='json')

    def test_register_creates_unverified_user_and_emails_a_code(self, send_mail):
        response = self.register()

        self.assertEqual(response.status_code, 201)
        self.assertNotIn('password', response.data)
        user = User.objects.get(email='new@example.com')
        self.assertFalse(user.is_verified)
        code = cache.get('verify_code:new@example.com')
        self.assertRegex(code, r'^\d{6}$')
        send_mail.delay.assert_called_once_with('new@example.com', code)

    def test_mismatched_passwords_are_rejected(self, send_mail):
        response = self.register(confirm_password='Different-pass1!')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.exists())
        send_mail.delay.assert_not_called()

    def test_duplicate_email_is_rejected(self, send_mail):
        make_user(email='new@example.com')
        self.assertEqual(self.register().status_code, 400)

    def test_weak_password_is_rejected(self, send_mail):
        response = self.register(password='12345678', confirm_password='12345678')
        self.assertEqual(response.status_code, 400)

    def test_queue_failure_still_creates_the_account(self, send_mail):
        send_mail.delay.side_effect = ConnectionError('broker down')
        with self.assertLogs('accounts.views', 'ERROR'):
            response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email='new@example.com').exists())


@mock.patch('accounts.views.send_mail')
class EmailVerificationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = make_user(email='new@example.com', verified=False)
        cache.set('verify_code:new@example.com', '123456')

    def test_correct_code_verifies_the_account(self, send_mail):
        response = self.client.post(VERIFY, {'email': 'new@example.com', 'code': '123456'})

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_verified)
        self.assertIsNone(cache.get('verify_code:new@example.com'), 'a code must not be reusable')

    def test_wrong_code_is_rejected(self, send_mail):
        response = self.client.post(VERIFY, {'email': 'new@example.com', 'code': '000000'})
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_verified)

    def test_expired_code_is_rejected(self, send_mail):
        cache.delete('verify_code:new@example.com')
        response = self.client.post(VERIFY, {'email': 'new@example.com', 'code': '123456'})
        self.assertEqual(response.status_code, 400)

    def test_resend_replaces_the_code(self, send_mail):
        response = self.client.post(RESEND, {'email': 'new@example.com'})

        self.assertEqual(response.status_code, 200)
        new_code = cache.get('verify_code:new@example.com')
        send_mail.delay.assert_called_once_with('new@example.com', new_code)

    def test_resend_refuses_an_already_verified_account(self, send_mail):
        self.user.is_verified = True
        self.user.save()
        self.assertEqual(self.client.post(RESEND, {'email': 'new@example.com'}).status_code, 400)
        send_mail.delay.assert_not_called()


class LoginAndProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = make_user()

    def test_login_returns_jwt_pair(self):
        response = self.client.post(LOGIN, {'email': 'user@example.com', 'password': 'Str0ng-pass!'})
        self.assertEqual(response.status_code, 200)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_login_with_wrong_password_fails(self):
        response = self.client.post(LOGIN, {'email': 'user@example.com', 'password': 'nope'})
        self.assertEqual(response.status_code, 401)

    def test_profile_requires_authentication(self):
        self.assertEqual(self.client.get(ME).status_code, 401)

    def test_profile_with_token(self):
        token = self.client.post(LOGIN, {'email': 'user@example.com', 'password': 'Str0ng-pass!'}).data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        response = self.client.get(ME)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['email'], 'user@example.com')

    def test_email_and_verified_flag_are_read_only(self):
        self.client.force_authenticate(self.user)
        self.user.is_verified = False
        self.user.save()
        self.client.patch(ME, {'email': 'other@example.com', 'is_verified': True, 'first_name': 'New'})
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'user@example.com')
        self.assertFalse(self.user.is_verified)
        self.assertEqual(self.user.first_name, 'New')


@mock.patch('accounts.views.send_password_reset_email')
class PasswordResetTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = make_user()
        self.redis = FakeRedis()
        for target in ('accounts.views.redis_client', 'accounts.serializers.redis_client'):
            patcher = mock.patch(target, self.redis)
            patcher.start()
            self.addCleanup(patcher.stop)

    def confirm(self, code, password='An0ther-pass!'):
        return self.client.post(RESET_CONFIRM, {
            'email': 'user@example.com', 'code': code,
            'new_password': password, 'confirm_password': password,
        })

    def test_request_emails_a_code(self, send_reset):
        response = self.client.post(RESET, {'email': 'user@example.com'})

        self.assertEqual(response.status_code, 200)
        code = self.redis.get(f'password_reset:{self.user.id}')
        send_reset.delay.assert_called_once_with('user@example.com', code)

    def test_unknown_email_gets_the_same_answer(self, send_reset):
        known = self.client.post(RESET, {'email': 'user@example.com'})
        unknown = self.client.post(RESET, {'email': 'nobody@example.com'})

        self.assertEqual(unknown.status_code, known.status_code)
        self.assertEqual(unknown.data, known.data, 'responses must not reveal which emails exist')
        send_reset.delay.assert_called_once()

    def test_correct_code_changes_the_password_once(self, send_reset):
        self.redis.setex(f'password_reset:{self.user.id}', 600, '654321')

        self.assertEqual(self.confirm('654321').status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('An0ther-pass!'))
        self.assertEqual(self.confirm('654321', 'Th1rd-pass!').status_code, 400, 'code must be single-use')

    def test_wrong_code_is_rejected(self, send_reset):
        self.redis.setex(f'password_reset:{self.user.id}', 600, '654321')

        self.assertEqual(self.confirm('111111').status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Str0ng-pass!'))


class CodeGenerationTests(TestCase):
    def test_codes_are_six_digits_from_secrets(self):
        from accounts.utils import generate_code
        with mock.patch('accounts.utils.secrets.randbelow', return_value=42) as randbelow:
            self.assertEqual(generate_code(), '000042', 'leading zeros are kept')
        randbelow.assert_called_once_with(1_000_000)


@mock.patch('accounts.views.send_mail')
class VerificationBruteForceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = make_user(email='new@example.com', verified=False)
        cache.set('verify_code:new@example.com', '123456')

    def guess(self, code):
        return self.client.post(VERIFY, {'email': 'new@example.com', 'code': code})

    def test_five_wrong_guesses_destroy_the_code(self, send_mail):
        for _ in range(4):
            self.assertEqual(self.guess('000000').status_code, 400)
        response = self.guess('000000')
        self.assertIn('Too many wrong codes', str(response.data))

        self.assertEqual(self.guess('123456').status_code, 400, 'even the right code is dead now')
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_verified)

    def test_a_few_typos_do_not_lock_the_user_out(self, send_mail):
        for _ in range(4):
            self.guess('000000')
        self.assertEqual(self.guess('123456').status_code, 200)

    def test_a_new_code_gets_a_fresh_set_of_attempts(self, send_mail):
        for _ in range(4):
            self.guess('000000')
        self.client.post(RESEND, {'email': 'new@example.com'})
        new_code = cache.get('verify_code:new@example.com')
        for _ in range(4):
            self.guess('000000')
        self.assertEqual(self.guess(new_code).status_code, 200)

    def test_at_most_five_codes_per_hour(self, send_mail):
        for _ in range(5):
            self.assertEqual(self.client.post(RESEND, {'email': 'new@example.com'}).status_code, 200)
        self.assertEqual(self.client.post(RESEND, {'email': 'new@example.com'}).status_code, 429)
        self.assertEqual(send_mail.delay.call_count, 5)


@mock.patch('accounts.views.send_password_reset_email')
class PasswordResetBruteForceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = make_user()
        self.redis = FakeRedis()
        for target in ('accounts.views.redis_client', 'accounts.serializers.redis_client'):
            patcher = mock.patch(target, self.redis)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.redis.setex(f'password_reset:{self.user.id}', 600, '654321')

    def confirm(self, code):
        return self.client.post(RESET_CONFIRM, {
            'email': 'user@example.com', 'code': code,
            'new_password': 'An0ther-pass!', 'confirm_password': 'An0ther-pass!',
        })

    def test_five_wrong_guesses_destroy_the_code(self, send_reset):
        for _ in range(5):
            self.assertEqual(self.confirm('111111').status_code, 400)

        self.assertEqual(self.confirm('654321').status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('Str0ng-pass!'), 'password must be unchanged')

    def test_request_limit_does_not_reveal_the_account(self, send_reset):
        answers = [self.client.post(RESET, {'email': 'user@example.com'}) for _ in range(6)]

        self.assertEqual({a.status_code for a in answers}, {200})
        self.assertEqual(len({str(a.data) for a in answers}), 1, 'the 6th answer looks like the rest')
        self.assertEqual(send_reset.delay.call_count, 5)
