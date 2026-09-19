from django.contrib import admin, messages
from django.shortcuts import redirect
from django.utils.safestring import mark_safe

from django.conf import settings
from .models import Quote, Customer, Driver, Vehicle, Client, RateCard, ClientQuoteLink



class CustomerInline(admin.TabularInline):
    model = Customer
    extra = 0
    readonly_fields = ['name', 'address', 'distance_from_previous_km', 'order', 'coords_lat', 'coords_lng']


@admin.register(Quote)
class QuoteAdmin(admin.ModelAdmin):
    list_display = ('id', 'quote_number', 'tracking_number', 'revenue', 'created_at', 'total_distance_km', 'total_weight_kg')
    list_filter = ('status', 'created_at')
    search_fields = ('quote_number', 'tracking_number')
    change_form_template = 'admin/quotes/quote/change_form.html'

    readonly_fields = (
        'created_at',
        'quote_number',
        'tracking_number',
        'route_map',
        'total_distance_km',
        'cogs',
        'revenue',
        'parcels',
        'quote_expiry_date',
        'sender_name', 'sender_email', 'sender_phone',
        'recipient_name', 'recipient_email', 'recipient_phone',
                'liability_cover', 'early_collection', 'signature_on_delivery', 'wedding_venue',
                'special_instructions',
                'delivery_directions',


    )

    ordering = ('-created_at',)
    inlines = [CustomerInline]

    fieldsets = (
        ('Quote Info', {
            'fields': ('quote_number', 'tracking_number', 'revenue', 'created_at', 'quote_expiry_date')
        }),
        ('Contact Information', {
            'fields': (
                'sender_name', 'sender_email', 'sender_phone',
                'recipient_name', 'recipient_email', 'recipient_phone',
            )
        }),
        ('Route Details', {
            'fields': (
                'depot_address', 'bakery_address', 'end_depot_address',
                'total_distance_km', 'route_map',
            )
        }),
        ('Special Requests', {
            'fields': (
                'liability_cover', 'early_collection', 'signature_on_delivery',
'wedding_venue', 'special_instructions', 'delivery_directions'
            )
        }),

        ('Parcels', {
            'fields': ('parcels',)
        }),
        ('Financial', {
            'fields': ('cogs', 'margin_percent', 'total_weight_kg')
        }),
    )

    def changelist_view(self, request, extra_context=None):
        # (status update is handled in change_view)

        from django.db.models import Sum
        from datetime import date, timedelta

        today = date.today()
        total = Quote.objects.count()
        accepted = Quote.objects.filter(status='accepted').count()

        pending_today = Quote.objects.filter(status='pending', created_at__date=today).count()
        pending_yesterday = Quote.objects.filter(status='pending', created_at__date=today - timedelta(days=1)).count()
        if pending_yesterday > 0:
            pending_change = round(((pending_today - pending_yesterday) / pending_yesterday) * 100, 1)
            pending_trend = f"{'+' if pending_change >= 0 else ''}{pending_change}% from yesterday"
        else:
            pending_trend = "No data from yesterday"

        extra_context = extra_context or {}
        extra_context.update({
            'pending_count': Quote.objects.filter(status='pending').count(),
            'pending_trend': pending_trend,
            'avg_response_time': '—',
            'conversion_rate': round((accepted / total * 100), 1) if total > 0 else 0,
            'revenue_potential': Quote.objects.filter(
                status='pending',
                created_at__month=today.month,
                created_at__year=today.year,
            ).aggregate(total=Sum('revenue'))['total'] or 0,
            'today': today,
        })
        return super().changelist_view(request, extra_context=extra_context)

    def change_view(self, request, object_id, form_url='', extra_context=None):
        """Handle custom status update buttons from the quote change form."""
        if request.method == 'POST' and request.POST.get('_status_update'):
            quote = self.get_object(request, object_id)
            if quote:
                new_status = request.POST.get('status')
                allowed = dict(Quote.STATUS_CHOICES).keys()
                if new_status in allowed:
                    quote.status = new_status
                    quote.save()
                    self.message_user(
                        request,
                        f'Quote status updated to {quote.get_status_display()}.',
                        messages.SUCCESS,
                    )
                    return redirect(request.path)
        return super().change_view(request, object_id, form_url, extra_context)

    def response_change(self, request, obj):
        if '_status_update' in request.POST:

            new_status = request.POST.get('status')
            if new_status in dict(obj.STATUS_CHOICES):
                obj.status = new_status
                obj.save()
                self.message_user(request, f"Quote status updated to {obj.get_status_display()}.")
            return redirect(request.path)
        return super().response_change(request, obj)


    def route_map(self, obj):
        if not obj.pickup_coords_lat or not obj.pickup_coords_lng:
            return "No route data available"

        depot_lat, depot_lng = -25.765757, 28.288375

        coords = [[depot_lat, depot_lng], [float(obj.pickup_coords_lat), float(obj.pickup_coords_lng)]]
        for customer in obj.customers.all():
            if customer.coords_lat and customer.coords_lng:
                coords.append([float(customer.coords_lat), float(customer.coords_lng)])
        coords.append([depot_lat, depot_lng])

        pickup_name = obj.bakery_address[:30] if obj.bakery_address else 'Pickup'
        dropoff_markers = []
        for i, customer in enumerate(obj.customers.all()):
            if customer.coords_lat and customer.coords_lng:
                name = customer.address[:20] if customer.address else f'Dropoff {i+1}'
                dropoff_markers.append(f"L.marker([{customer.coords_lat}, {customer.coords_lng}]).bindPopup('{name}').addTo(map);")

        dropoff_js = '\n                '.join(dropoff_markers)
        coords_json = str(coords).replace("'", "")

        map_html = f'''
        <div id="quote-map-{obj.id}" style="height: 400px; width: 100%; border: 1px solid #ddd;"></div>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            (function() {{
                var map = L.map('quote-map-{obj.id}').setView([{-26.2041}, {28.0473}], 12);
                L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
                    attribution: '© OpenStreetMap contributors'
                }}).addTo(map);

                var bounds = [];
                var latlngs = {coords_json};

                L.marker([{depot_lat}, {depot_lng}]).bindPopup('Depot').addTo(map);
                L.marker([{obj.pickup_coords_lat}, {obj.pickup_coords_lng}]).bindPopup('Pickup: {pickup_name}').addTo(map);
                {dropoff_js}

                L.polyline(latlngs, {{color: '#000f22', weight: 4}}).addTo(map);
                latlngs.forEach(coord => bounds.push(coord));

                if (bounds.length > 0) {{
                    map.fitBounds(bounds);
                }}
            }})();
        </script>
        '''
        return mark_safe(map_html)
    route_map.short_description = 'Route Map'


@admin.register(Driver)
class DriverAdmin(admin.ModelAdmin):
    list_display = ('name', 'initials')
    search_fields = ('name',)


@admin.register(Vehicle)
class VehicleAdmin(admin.ModelAdmin):
    list_display = ('vehicle_id', 'license_plate', 'type', 'status', 'model_name', 'driver')
    list_filter = ('status', 'type')
    search_fields = ('vehicle_id', 'license_plate')


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ('client_id', 'name', 'email', 'status', 'loyalty', 'total_spent')
    list_filter = ('status', 'loyalty')
    search_fields = ('name', 'email')

@admin.register(RateCard)
class RateCardAdmin(admin.ModelAdmin):
    list_display = ('name', 'cost_per_km', 'margin_percent', 'fuel_surcharge_percent',
                    'min_delivery_fee', 'is_default', 'is_active', 'updated_at')
    list_filter = ('is_default', 'is_active')
    search_fields = ('name',)
    list_editable = ('cost_per_km', 'margin_percent', 'fuel_surcharge_percent',
                     'min_delivery_fee', 'is_active')


@admin.register(ClientQuoteLink)
class ClientQuoteLinkAdmin(admin.ModelAdmin):
    list_display = ('client', 'rate_card', 'shareable_link', 'is_active', 'expires_at', 'created_at')
    list_filter = ('is_active', 'rate_card')
    search_fields = ('client__name', 'label', 'token')
    readonly_fields = ('token', 'shareable_link', 'created_at')
    autocomplete_fields = ('client',)
    fields = ('client', 'rate_card', 'label',
              'collection_name', 'collection_address', 'collection_lat', 'collection_lng',
              'is_active', 'expires_at', 'token', 'shareable_link', 'created_at')

    def save_model(self, request, obj, form, change):
        # Auto-locate the collection address so ops only type the address, not coordinates.
        if obj.collection_address and (obj.collection_lat is None or obj.collection_lng is None):
            from decimal import Decimal
            from .views import geocode_address
            coords = geocode_address(obj.collection_address)
            if coords:
                obj.collection_lat = Decimal(str(coords[0]))
                obj.collection_lng = Decimal(str(coords[1]))
            else:
                messages.warning(request, 'Could not auto-locate the collection address. '
                    'Enter the latitude/longitude manually, otherwise the client will be asked to type the collection address.')
        super().save_model(request, obj, form, change)

    def _base_url(self):
        return (getattr(settings, 'PUBLIC_SITE_URL', '') or 'https://delicatecourier.co.za').rstrip('/')

    def shareable_link(self, obj):
        if not obj.token:
            return "(save to generate the link)"
        url = f"{self._base_url()}/quote?c={obj.token}"
        return mark_safe(f'<a href="{url}" target="_blank">{url}</a>')
    shareable_link.short_description = 'Shareable link'
