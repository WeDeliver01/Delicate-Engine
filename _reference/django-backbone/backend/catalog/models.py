"""
Configurable catalog: package types and parcel categories.

These are super-admin configuration rows (not hardcoded), so the booking form's
package-type and parcel-category pickers, and their default dimensions, are
edited in one place. Mirrors the screenshots' "Platters Medium" package type and
"Freshly Prepared Platters" parcel category, on Delicate's own terms.
"""
from decimal import Decimal

from django.db import models


class PackageType(models.Model):
    """A named package with default dimensions, to keep booking fast: pick the
    type and the dimensions prefill (still editable per parcel)."""
    name = models.CharField(max_length=80, unique=True)
    default_length_cm = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal('0'))
    default_width_cm = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal('0'))
    default_height_cm = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal('0'))
    default_weight_kg = models.DecimalField(max_digits=7, decimal_places=2, default=Decimal('0'))
    sort_order = models.PositiveIntegerField(default=100)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class ParcelCategory(models.Model):
    """What is inside. Delicate carries perishables, so handling flags live here
    and can drive routing/priority rules later."""
    name = models.CharField(max_length=80, unique=True)
    description = models.CharField(max_length=200, blank=True)
    perishable = models.BooleanField(default=False)
    fragile = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=100)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'name']
        verbose_name_plural = 'Parcel categories'

    def __str__(self):
        return self.name
