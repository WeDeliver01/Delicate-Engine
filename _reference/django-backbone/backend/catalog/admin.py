from django.contrib import admin

from .models import PackageType, ParcelCategory


@admin.register(PackageType)
class PackageTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'default_length_cm', 'default_width_cm',
                    'default_height_cm', 'default_weight_kg', 'active', 'sort_order')
    list_editable = ('active', 'sort_order')


@admin.register(ParcelCategory)
class ParcelCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'perishable', 'fragile', 'active', 'sort_order')
    list_editable = ('perishable', 'fragile', 'active', 'sort_order')
