"""Read endpoints the booking form uses to populate pickers."""
from django.http import JsonResponse

from .models import PackageType, ParcelCategory


def catalog(request):
    """GET /api/catalog - active package types and parcel categories."""
    pkgs = list(PackageType.objects.filter(active=True).values(
        'id', 'name', 'default_length_cm', 'default_width_cm',
        'default_height_cm', 'default_weight_kg'))
    cats = list(ParcelCategory.objects.filter(active=True).values(
        'id', 'name', 'description', 'perishable', 'fragile'))
    # Decimals -> strings for clean JSON
    for p in pkgs:
        for k in ('default_length_cm', 'default_width_cm', 'default_height_cm', 'default_weight_kg'):
            p[k] = str(p[k])
    return JsonResponse({'package_types': pkgs, 'parcel_categories': cats})
