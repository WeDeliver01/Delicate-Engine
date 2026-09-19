from django.urls import path

from . import api

urlpatterns = [
    path('api/catalog', api.catalog),
    path('api/catalog/', api.catalog),
]
