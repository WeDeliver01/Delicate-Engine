from django.apps import AppConfig


class CatalogConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'backend.catalog'
    label = 'catalog'
    verbose_name = 'Package & Parcel Catalog'
