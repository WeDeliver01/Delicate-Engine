from django.apps import AppConfig


class TrackingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.tracking'
    label = 'tracking'
    verbose_name = 'Unified Shipments & Tracking'
