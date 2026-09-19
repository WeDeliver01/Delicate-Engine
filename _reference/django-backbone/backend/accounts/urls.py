from django.urls import path

from . import api

urlpatterns = [
    path('api/portal/me', api.me),
    path('api/portal/me/', api.me),
    path('api/portal/my-shipments', api.my_shipments),
    path('api/portal/my-shipments/', api.my_shipments),
]
