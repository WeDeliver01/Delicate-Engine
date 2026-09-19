# Optional: osmnx for alternative routing. Not required for core app functionality.
try:
    import osmnx as ox
    HAS_OSMNX = True
except ImportError:
    ox = None
    HAS_OSMNX = False

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Quote, Customer, Vehicle, Client, Driver, SiteSettings
from .serializers import QuoteCreateSerializer, QuoteSerializer
from django.contrib.auth.decorators import login_required, user_passes_test
from django.core.paginator import Paginator
from django.db.models import Count, Sum
from django.http import JsonResponse
from django.shortcuts import render
from django.contrib.auth.models import User
from django.views.decorators.csrf import csrf_exempt
import json
import urllib.request
import urllib.parse
import urllib.error
from django.core.paginator import Paginator
from django.shortcuts import render
from django.contrib.auth.decorators import login_required, user_passes_test
from .models import Client

COST_PER_KM = 1.7   # updated from 1.5


def haversine_distance(coord1, coord2):
    """Calculate straight-line distance between two coordinate pairs using Haversine formula."""
    from math import radians, sin, cos, sqrt, atan2
    R = 6371
    lat1, lon1 = coord1
    lat2, lon2 = coord2
    dLat = radians(lat2 - lat1)
    dLon = radians(lon2 - lon1)
    a = sin(dLat/2) * sin(dLat/2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2) * sin(dLon/2)
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c


def geocode_address(address):
    """Geocode an address using Nominatim."""
    if not address or not address.strip():
        return None
    try:
        params = urllib.parse.urlencode({'q': address.strip(), 'format': 'json', 'limit': '1'})
        url = f'https://nominatim.openstreetmap.org/search?{params}'
        req = urllib.request.Request(url, headers={'User-Agent': 'DelicateCourierQuoteGenerator/1.0 (contact@delicatecourier.co.za)'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            if data and len(data) > 0:
                return [float(data[0]['lat']), float(data[0]['lon'])]
    except Exception:
        pass
    return None


def calculate_distance_between_addresses(pickup_address, delivery_address):
    """Calculate distance in km between two addresses."""
    pickup_coords = geocode_address(pickup_address)
    delivery_coords = geocode_address(delivery_address)
    if not pickup_coords or not delivery_coords:
        return None
    return round(haversine_distance(pickup_coords, delivery_coords), 2)


@csrf_exempt
def estimate_price(request):
    """
    API endpoint: /api/estimate/ (POST)
    One-way distance + price between pickup and delivery.
    Optional body field "client_token" (or ?c=) selects a client's rate card.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST method required'}, status=405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    pickup_address = data.get('pickup_address', '').strip()
    delivery_address = data.get('delivery_address', '').strip()

    if not pickup_address or not delivery_address:
        return JsonResponse({'error': 'Both pickup_address and delivery_address are required'}, status=400)

    distance = calculate_distance_between_addresses(pickup_address, delivery_address)

    if distance is None:
        return JsonResponse({'error': 'Could not locate one of the addresses'}, status=400)

    from .pricing import resolve_rate_card, compute_price
    token = data.get('client_token') or request.GET.get('c')
    rate_card, link = resolve_rate_card(token)
    priced = compute_price(distance, rate_card)

    return JsonResponse({
        'distance_km': priced['distance_km'],
        'price': priced['price'],
        'rate_card': priced['rate_card'],
        'client_name': link.client.name if link else None,
    })


@csrf_exempt
def rate_context(request):
    """
    API endpoint: /api/rate-context/ (GET)
    Returns the rate values + client info for a given link token (?c=<token>),
    so the frontend can display the correct price and a client banner.
    No/invalid token falls back to the default card.
    """
    from .pricing import resolve_rate_card
    token = request.GET.get('c') or request.GET.get('client_token')
    rate_card, link = resolve_rate_card(token)
    return JsonResponse({
        'cost_per_km': float(rate_card.cost_per_km),
        'margin': float(rate_card.margin_fraction),
        'fuel_surcharge_percent': float(rate_card.fuel_surcharge_percent),
        'min_delivery_fee': float(rate_card.min_delivery_fee),
        'rate_card': rate_card.name,
        'is_client_link': link is not None,
        'client_name': link.client.name if link else None,
        'label': link.label if link else '',
        # Pre-configured collection point (so the client only enters a delivery address)
        'has_preset_collection': bool(link and link.has_preset_collection),
        'collection_name': link.collection_name if link else '',
        'collection_address': link.collection_address if link else '',
        'collection_lat': float(link.collection_lat) if (link and link.collection_lat is not None) else None,
        'collection_lng': float(link.collection_lng) if (link and link.collection_lng is not None) else None,
        # Client (sender) details, pre-filled on the contact step
        'sender_name': link.client.name if link else '',
        'sender_email': link.client.email if link else '',
        'sender_phone': link.client.phone if link else '',
    })


def calculate_route_distance_osmnx(origin_address, destination_address):
    """
    Geocode two addresses and compute the shortest road network distance (km) between them.
    Returns distance in kilometers, or None if geocoding fails.
    Requires optional dependency: osmnx (pip install osmnx)
    """
    if not HAS_OSMNX:
        print("OSMnx not installed. Install with: pip install osmnx")
        return None
    try:
        origin_point = ox.geocode(origin_address)
        destination_point = ox.geocode(destination_address)

        if not origin_point or not destination_point:
            return None

        graph = ox.graph_from_point(
            (origin_point[0], origin_point[1]),
            dist=5000,
            network_type='drive',
            simplify=True
        )

        origin_node = ox.nearest_nodes(graph, origin_point[1], origin_point[0])
        destination_node = ox.nearest_nodes(graph, destination_point[1], destination_point[0])

        distance_m = ox.shortest_path_length(graph, origin_node, destination_node, weight='length')
        distance_km = distance_m / 1000.0
        return round(distance_km, 2)
    except Exception as e:
        print(f"OSMnx error: {e}")
        return None


class QuoteViewSet(viewsets.ModelViewSet):
    """
    API endpoint for creating and retrieving delivery quotes.
    POST /api/quotes/ creates a quote (with distances in km).
    GET /api/quotes/<id>/ retrieves a saved quote.
    """
    queryset = Quote.objects.prefetch_related('customers').all()
    serializer_class = QuoteSerializer

    def get_serializer_class(self):
        if self.action == 'create':
            return QuoteCreateSerializer
        return QuoteSerializer

    def create(self, request, *args, **kwargs):
        from .pricing import resolve_rate_card

        token = request.data.get('client_token') or request.query_params.get('c')
        rate_card, client_link = resolve_rate_card(token)

        context = self.get_serializer_context()
        context['rate_card'] = rate_card
        context['client_link'] = client_link

        serializer = self.get_serializer(data=request.data, context=context)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            quote = serializer.save()

        return Response(
            QuoteSerializer(quote).data,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['post'])
    def calculate_from_osm(self, request):
        data = request.data
        depot = data.get('depot_address')
        bakery = data.get('bakery_address')
        customers = data.get('customers', [])

        if not depot or not bakery:
            return Response(
                {'error': 'Depot and bakery addresses required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        depot_to_bakery = calculate_route_distance_osmnx(depot, bakery)
        if depot_to_bakery is None:
            return Response(
                {'error': f'Could not calculate distance: Depot -> Bakery'},
                status=status.HTTP_400_BAD_REQUEST
            )

        bakery_to_first = None
        if customers:
            first_addr = customers[0].get('address')
            if first_addr:
                bakery_to_first = calculate_route_distance_osmnx(bakery, first_addr)
                if bakery_to_first is None:
                    return Response(
                        {'error': f'Could not calculate distance: Bakery -> {first_addr}'},
                        status=status.HTTP_400_BAD_REQUEST
                    )

        customer_distances = []
        for i, cust in enumerate(customers):
            addr = cust.get('address')
            if i < len(customers) - 1:
                next_addr = customers[i+1].get('address')
                dist = calculate_route_distance_osmnx(addr, next_addr)
                if dist is None:
                    return Response(
                        {'error': f'Could not calculate: {addr} -> {next_addr}'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                customer_distances.append(dist)
            else:
                end_depot = data.get('end_depot_address', depot)
                dist = calculate_route_distance_osmnx(addr, end_depot)
                if dist is None:
                    return Response(
                        {'error': f'Could not calculate: {addr} -> {end_depot}'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                customer_distances.append(dist)

        return Response({
            'depot_to_bakery_km': depot_to_bakery,
            'bakery_to_first_customer_km': bakery_to_first,
            'customer_distances': customer_distances,
            'message': 'Distances calculated. Use /api/quotes/ to save.'
        })


@login_required
@user_passes_test(lambda u: u.is_staff, login_url='admin:login')
def user_dashboard(request):
    users = User.objects.all().prefetch_related('profile')

    paginator = Paginator(users, 10)
    page_number = request.GET.get('page')
    page_obj = paginator.get_page(page_number)

    context = {
        'total_users': users.count(),
        'users_this_quarter': 0,
        'active_now': 0,
        'total_roles': 4,
        'pending_invites': 0,
        'expired_invites': 0,
        'search_query': '',
        'selected_role': '',
        'selected_status': '',
        'role_choices': [
            ('admin', 'Admin'),
            ('dispatcher', 'Dispatcher'),
            ('finance', 'Finance'),
            ('viewer', 'Viewer'),
        ],
        'status_choices': [
            ('active', 'Active'),
            ('inactive', 'Inactive'),
            ('invited', 'Pending'),
        ],
        'users': page_obj.object_list,
        'security_events': [],
        'security_audit_message': 'No security alerts.',
        'is_paginated': paginator.num_pages > 1,
        'page_obj': page_obj,
        'paginator': paginator,
    }
    return render(request, 'admin/users/user_list.html', context)


# --- DASHBOARD VIEW (for root URL) ---
@login_required
@user_passes_test(lambda u: u.is_staff, login_url='admin:login')
def dashboard(request):
    quote_count = Quote.objects.count()
    total_revenue = Quote.objects.aggregate(total=Sum('revenue'))['total'] or 0
    total_distance = Quote.objects.aggregate(total=Sum('total_distance_km'))['total'] or 0
    customer_count = Customer.objects.count()
    recent_quotes = Quote.objects.order_by('-created_at')[:5]

    context = {
        'quote_count': quote_count,
        'total_revenue': total_revenue,
        'total_distance': total_distance,
        'customer_count': customer_count,
        'recent_quotes': recent_quotes,
    }
    return render(request, 'admin/index.html', context)


@login_required
@user_passes_test(lambda u: u.is_staff, login_url='admin:login')
def settings_dashboard(request):
    settings = SiteSettings.load()
    context = {
        'company_name': settings.company_name,
        'currency': settings.currency,
        'language': settings.language,
        'timezone': settings.timezone,
        'email_quotes': settings.email_quotes,
        'sms_updates': settings.sms_updates,
        'webhook_url': settings.webhook_url,
        'markup_percent': settings.markup_percent,
        'min_delivery_fee': settings.min_delivery_fee,
        'fuel_surcharge': settings.fuel_surcharge,
        'google_maps_key': settings.google_maps_key,
        'session_timeout': settings.session_timeout,
        'allowed_ips': settings.allowed_ips,
    }
    return render(request, 'admin/settings/settings.html', context)


@login_required
@user_passes_test(lambda u: u.is_staff, login_url='admin:login')
def download_quote_pdf(request, quote_id):
    from django.shortcuts import get_object_or_404
    from django.template.loader import render_to_string
    from django.http import HttpResponse
    from weasyprint import HTML, CSS
    import tempfile, os

    quote = get_object_or_404(Quote, pk=quote_id)
    html_string = render_to_string('admin/quotes/quote/pdf_template.html', {'quote': quote})
    pdf_bytes = HTML(string=html_string, base_url=request.build_absolute_uri('/')).write_pdf()
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="quote_{quote.quote_number or quote.id}.pdf"'
    return response


@login_required
@user_passes_test(lambda u: u.is_staff, login_url='admin:login')
def settings_save(request):
    if request.method == 'POST':
        settings = SiteSettings.load()
        settings.company_name = request.POST.get('company_name', settings.company_name)
        settings.currency = request.POST.get('currency', settings.currency)
        settings.language = request.POST.get('language', settings.language)
        settings.timezone = request.POST.get('timezone', settings.timezone)
        settings.email_quotes = request.POST.get('email_quotes') == 'on'
        settings.sms_updates = request.POST.get('sms_updates') == 'on'
        settings.webhook_url = request.POST.get('webhook_url') or ''
        settings.markup_percent = request.POST.get('markup_percent', settings.markup_percent)
        settings.min_delivery_fee = request.POST.get('min_delivery_fee', settings.min_delivery_fee)
        settings.fuel_surcharge = request.POST.get('fuel_surcharge', settings.fuel_surcharge)
        settings.google_maps_key = request.POST.get('google_maps_key', '')
        settings.session_timeout = int(request.POST.get('session_timeout', 30))
        settings.allowed_ips = request.POST.get('allowed_ips', '')
        settings.save()
        return JsonResponse({'status': 'ok'})
    return JsonResponse({'error': 'Invalid method'}, status=400)