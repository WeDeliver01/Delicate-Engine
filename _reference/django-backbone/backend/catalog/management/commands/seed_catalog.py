"""Seed a starter catalog. Idempotent."""
from decimal import Decimal

from django.core.management.base import BaseCommand

from backend.catalog.models import PackageType, ParcelCategory

PACKAGES = [
    ('Satchel', 30, 22, 5, 1),
    ('Box Small', 20, 20, 20, 2),
    ('Box Medium', 40, 30, 30, 5),
    ('Box Large', 60, 40, 40, 10),
    ('Platters Medium', 30, 30, 10, 3),
    ('Platters Large', 45, 45, 12, 6),
    ('Cake Box', 35, 35, 25, 4),
]
CATEGORIES = [
    ('Freshly Prepared Platters', True, True),
    ('Baked Goods', True, True),
    ('Cakes', True, True),
    ('Dry Goods', False, False),
    ('General', False, False),
]


class Command(BaseCommand):
    help = "Seed default package types and parcel categories."

    def handle(self, *args, **opts):
        for i, (name, l, w, h, kg) in enumerate(PACKAGES):
            PackageType.objects.get_or_create(name=name, defaults={
                'default_length_cm': Decimal(l), 'default_width_cm': Decimal(w),
                'default_height_cm': Decimal(h), 'default_weight_kg': Decimal(kg),
                'sort_order': i * 10})
        for i, (name, perish, fragile) in enumerate(CATEGORIES):
            ParcelCategory.objects.get_or_create(name=name, defaults={
                'perishable': perish, 'fragile': fragile, 'sort_order': i * 10})
        self.stdout.write(self.style.SUCCESS('catalog seeded'))
