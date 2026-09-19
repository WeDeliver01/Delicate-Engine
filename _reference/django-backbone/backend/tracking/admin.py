from django.contrib import admin

from .models import Shipment, TrackingEvent


@admin.register(Shipment)
class ShipmentAdmin(admin.ModelAdmin):
    list_display = ('tracking_number', 'consignment_id', 'client', 'origin',
                    'stage', 'recipient_name', 'created_at')
    list_filter = ('origin', 'stage')
    search_fields = ('tracking_number', 'consignment_id', 'custom_tracking_reference',
                     'customer_reference', 'recipient_name')


@admin.register(TrackingEvent)
class TrackingEventAdmin(admin.ModelAdmin):
    list_display = ('shipment', 'status', 'location', 'occurred_at', 'source')
    search_fields = ('shipment__tracking_number',)
