"""Real rate endpoints: compute from a card, resolve per-client, super-admin manage."""
import json
import time
from decimal import Decimal

import jwt
from django.test import TestCase, override_settings

from backend.quotes.models import Client, RateCard, ClientQuoteLink

SECRET = 'rate-card-test-secret-32-bytes-long!!'


def tok(role='SuperAdmin', sub='boss'):
    return jwt.encode({'sub': sub, 'aud': 'authenticated', 'app_role': role,
                       'iat': int(time.time()), 'exp': int(time.time()) + 3600},
                      SECRET, algorithm='HS256')


@override_settings(SUPABASE_JWT_SECRET=SECRET, SUPABASE_AUD='authenticated', APPEND_SLASH=False)
class RateEndpointTests(TestCase):
    def setUp(self):
        self.default = RateCard.objects.create(name='Default', cost_per_km=Decimal('1.98'),
            margin_percent=Decimal('55'), fuel_surcharge_percent=Decimal('10'),
            min_delivery_fee=Decimal('60'), is_default=True)

    def test_rate_quote_uses_default_card(self):
        r = self.client.post('/api/quote/rate', data=json.dumps({'distance_km': 15}),
                             content_type='application/json')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        # base = 15*1.98/(1-0.55)=66.0 ; fuel 10% =6.6 ; total 72.6
        self.assertEqual(body['total_cents'], 7260)
        self.assertEqual(body['base_cents'] + body['fuel_levy_cents'], body['total_cents'])

    def test_rate_quote_resolves_client_card(self):
        c = Client(name='BBN', email='s@b.co.za'); c.save()
        premium = RateCard.objects.create(name='BBN card', cost_per_km=Decimal('2.50'),
            margin_percent=Decimal('55'), fuel_surcharge_percent=Decimal('0'))
        ClientQuoteLink.objects.create(client=c, rate_card=premium, is_active=True)
        r = self.client.post('/api/quote/rate',
                             data=json.dumps({'distance_km': 15, 'client_id': c.id}),
                             content_type='application/json')
        self.assertEqual(r.json()['rate_card'], 'BBN card')

    def test_floor_applies(self):
        r = self.client.post('/api/quote/rate', data=json.dumps({'distance_km': 1}),
                             content_type='application/json')
        self.assertEqual(r.json()['total_cents'], 6000)   # below floor -> R60

    def test_rate_cards_requires_super_admin(self):
        self.assertEqual(self.client.get('/api/admin/rate-cards').status_code, 401)
        r = self.client.get('/api/admin/rate-cards', HTTP_AUTHORIZATION=f'Bearer {tok()}')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(any(c['is_default'] for c in r.json()['rate_cards']))

    def test_super_admin_updates_levers(self):
        r = self.client.put('/api/admin/rate-cards',
                            data=json.dumps({'id': self.default.id, 'cost_per_km': '2.20'}),
                            content_type='application/json',
                            HTTP_AUTHORIZATION=f'Bearer {tok()}')
        self.assertEqual(r.status_code, 200)
        self.default.refresh_from_db()
        self.assertEqual(self.default.cost_per_km, Decimal('2.20'))
