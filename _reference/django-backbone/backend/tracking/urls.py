from django.urls import path

from . import api

urlpatterns = [
    path('api/webhooks/shiplogic/tracking', api.shiplogic_tracking_webhook),
    path('api/webhooks/shiplogic/tracking/', api.shiplogic_tracking_webhook),
    path('api/sync/shipments', api.sync_shipments),
    path('api/sync/shipments/', api.sync_shipments),
    path('api/sync/driver-position', api.driver_position),
    path('api/sync/driver-position/', api.driver_position),
    path('api/portal/shipments/<int:client_id>', api.portal_shipments),
    path('api/portal/shipments/<int:client_id>/', api.portal_shipments),
]
