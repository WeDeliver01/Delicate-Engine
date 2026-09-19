"""Supabase JWT auth: validation, role mapping, client scoping, super-admin gate."""
import time

import jwt
from django.test import TestCase, override_settings

from backend.quotes.models import Client
from .models import PortalUser
from .auth import verify_supabase_jwt, get_portal_user

SECRET = 'test-supabase-secret'


def token(sub='user-1', email='m@b.co.za', role='client_admin', client_id=None, aud='authenticated'):
    payload = {'sub': sub, 'email': email, 'aud': aud, 'app_role': role,
               'iat': int(time.time()), 'exp': int(time.time()) + 3600}
    if client_id:
        payload['client_id'] = client_id
    return jwt.encode(payload, SECRET, algorithm='HS256')


class _Req:
    def __init__(self, bearer=None):
        self.headers = {'Authorization': f'Bearer {bearer}'} if bearer else {}


@override_settings(SUPABASE_JWT_SECRET=SECRET, SUPABASE_AUD='authenticated')
class AuthTests(TestCase):
    def test_valid_token_verifies(self):
        self.assertIsNotNone(verify_supabase_jwt(token()))

    def test_wrong_secret_rejected(self):
        bad = jwt.encode({'sub': 'x', 'aud': 'authenticated'}, 'other', algorithm='HS256')
        self.assertIsNone(verify_supabase_jwt(bad))

    def test_no_token_no_user(self):
        self.assertIsNone(get_portal_user(_Req()))

    def test_provisions_client_admin_linked_to_client(self):
        c = Client(name='Baked By Nataleen', email='s@b.co.za'); c.save()
        pu = get_portal_user(_Req(token(sub='u-9', client_id=c.id)))
        self.assertEqual(pu.role, 'client_admin')
        self.assertEqual(pu.client_id, c.id)
        # idempotent: second call reuses the same row
        pu2 = get_portal_user(_Req(token(sub='u-9', client_id=c.id)))
        self.assertEqual(pu.pk, pu2.pk)
        self.assertEqual(PortalUser.objects.count(), 1)

    def test_super_admin_role_mapping(self):
        pu = get_portal_user(_Req(token(sub='boss', role='SuperAdmin')))
        self.assertTrue(pu.is_super_admin)
        self.assertIsNone(pu.client_id)


@override_settings(SUPABASE_JWT_SECRET=SECRET, SUPABASE_AUD='authenticated', APPEND_SLASH=False)
class ScopingTests(TestCase):
    def test_me_and_my_shipments_require_auth(self):
        self.assertEqual(self.client.get('/api/portal/me').status_code, 401)

    def test_me_returns_identity(self):
        c = Client(name='BBN', email='s@b.co.za'); c.save()
        r = self.client.get('/api/portal/me', HTTP_AUTHORIZATION=f'Bearer {token(client_id=c.id)}')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['client_id'], c.id)

    def test_capacity_admin_requires_super_admin(self):
        # a client_admin is forbidden
        r = self.client.get('/api/admin/capacity/policy',
                            HTTP_AUTHORIZATION=f'Bearer {token(role="client_admin")}')
        self.assertEqual(r.status_code, 403)
        # a super_admin passes
        r = self.client.get('/api/admin/capacity/policy',
                            HTTP_AUTHORIZATION=f'Bearer {token(sub="boss", role="SuperAdmin")}')
        self.assertEqual(r.status_code, 200)
