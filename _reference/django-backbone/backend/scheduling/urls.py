from django.urls import path

from . import api

# APPEND_SLASH is False project-wide, so register both forms.
urlpatterns = [
    path('api/slots/availability', api.availability),
    path('api/slots/availability/', api.availability),
    path('api/admin/capacity/policy', api.policy),
    path('api/admin/capacity/policy/', api.policy),
    path('api/admin/capacity/slots', api.admin_slots),
    path('api/admin/capacity/slots/', api.admin_slots),
    path('api/admin/capacity/close', api.close_slot),
    path('api/admin/capacity/close/', api.close_slot),
    path('api/admin/capacity/set', api.set_capacity),
    path('api/admin/capacity/set/', api.set_capacity),
    path('api/admin/capacity/blackout', api.blackout),
    path('api/admin/capacity/blackout/', api.blackout),
]
