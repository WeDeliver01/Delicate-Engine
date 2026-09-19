from django.contrib import admin

from .models import PortalUser


@admin.register(PortalUser)
class PortalUserAdmin(admin.ModelAdmin):
    list_display = ('email', 'role', 'client', 'supabase_user_id', 'last_seen')
    list_filter = ('role',)
    search_fields = ('email', 'supabase_user_id')
