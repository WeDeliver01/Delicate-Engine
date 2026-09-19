from django.urls import path

from . import api
from . import rates_api
from .treasury import api as treasury_api

# APPEND_SLASH is False project-wide, so register both forms.
urlpatterns = [
    path('api/admin/treasury/dashboard', treasury_api.dashboard),
    path('api/admin/treasury/dashboard/', treasury_api.dashboard),
    path('api/quote/rate', rates_api.rate_quote),
    path('api/quote/rate/', rates_api.rate_quote),
    path('api/admin/rate-cards', rates_api.rate_cards),
    path('api/admin/rate-cards/', rates_api.rate_cards),
    path('api/finance/book-from-quote', api.book_from_quote),
    path('api/finance/book-from-quote/', api.book_from_quote),
    path('api/finance/topups', api.create_topup),
    path('api/finance/topups/', api.create_topup),
    path('api/finance/bookings', api.create_booking),
    path('api/finance/bookings/', api.create_booking),
    path('api/finance/webhooks/payment', api.payment_webhook),
    path('api/finance/webhooks/payment/', api.payment_webhook),
    path('api/finance/webhooks/shiplogic', api.shiplogic_webhook),
    path('api/finance/webhooks/shiplogic/', api.shiplogic_webhook),
    path('api/finance/wallets/<int:client_id>', api.wallet_detail),
    path('api/finance/wallets/<int:client_id>/', api.wallet_detail),
]
