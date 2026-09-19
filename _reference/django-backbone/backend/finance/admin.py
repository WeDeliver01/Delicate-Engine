from django.contrib import admin

from .models import (Wallet, LedgerEntry, TopUp, Booking, OutboxMessage,
                     ShipLogicShipment, ShipLogicBillingTxn, ProviderEvent,
                     Parcel, BookingIdentifier)


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('client', 'balance_cents', 'shiplogic_account_id', 'engine_account_ref')
    search_fields = ('client__name', 'shiplogic_account_id', 'engine_account_ref')


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ('id', 'wallet', 'kind', 'amount_cents', 'balance_after_cents',
                    'reference', 'created_at')
    list_filter = ('kind',)
    search_fields = ('reference',)
    # Append-only: no add/change/delete in admin.
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False


@admin.register(OutboxMessage)
class OutboxAdmin(admin.ModelAdmin):
    list_display = ('id', 'topic', 'event_type', 'status', 'attempts',
                    'next_attempt_at', 'created_at')
    list_filter = ('topic', 'status')
    search_fields = ('idempotency_key', 'event_type', 'last_error')
    readonly_fields = ('idempotency_key', 'payload', 'last_error')


@admin.register(TopUp)
class TopUpAdmin(admin.ModelAdmin):
    list_display = ('id', 'client', 'amount_cents', 'status', 'provider', 'created_at')
    list_filter = ('status', 'provider')


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ('reference', 'client', 'price_cents', 'status', 'created_at')
    list_filter = ('status',)
    search_fields = ('reference',)


admin.site.register(ShipLogicShipment)
admin.site.register(ShipLogicBillingTxn)
admin.site.register(ProviderEvent)


@admin.register(Parcel)
class ParcelAdmin(admin.ModelAdmin):
    list_display = ('booking', 'index', 'package_type', 'parcel_category',
                    'weight_kg', 'alt_tracking_ref')
    search_fields = ('booking__reference', 'alt_tracking_ref')


@admin.register(BookingIdentifier)
class BookingIdentifierAdmin(admin.ModelAdmin):
    list_display = ('value', 'kind', 'booking')
    search_fields = ('value',)
    list_filter = ('kind',)
