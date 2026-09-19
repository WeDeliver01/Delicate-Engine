from django.contrib import admin

from .models import SlotPolicy, DeliverySlot, BlackoutDate


@admin.register(SlotPolicy)
class SlotPolicyAdmin(admin.ModelAdmin):
    list_display = ('name', 'active', 'default_capacity', 'lead_time_minutes', 'updated_at')


@admin.register(DeliverySlot)
class DeliverySlotAdmin(admin.ModelAdmin):
    list_display = ('date', 'window_key', 'label', 'capacity', 'booked_count',
                    'status')
    list_filter = ('status', 'window_key', 'date')
    search_fields = ('label',)


@admin.register(BlackoutDate)
class BlackoutDateAdmin(admin.ModelAdmin):
    list_display = ('date', 'reason')
