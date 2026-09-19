from django.contrib import admin

from .models import (AllocationWallet, FundingTarget, ExpenseObligation,
                     AllocationRule, AllocationTransaction)


@admin.register(AllocationWallet)
class AllocationWalletAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'category', 'balance_cents', 'priority', 'is_active')
    list_filter = ('category', 'is_active')


@admin.register(ExpenseObligation)
class ExpenseObligationAdmin(admin.ModelAdmin):
    list_display = ('vendor', 'amount_cents', 'due_day', 'priority', 'is_active')


@admin.register(AllocationTransaction)
class AllocationTransactionAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'wallet', 'kind', 'amount_cents', 'period', 'booking', 'reversed')
    list_filter = ('kind', 'period', 'reversed')
    search_fields = ('idempotency_key', 'booking__reference')


admin.site.register([FundingTarget, AllocationRule])
