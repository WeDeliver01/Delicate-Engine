"""
HTTP surface for capacity.

Client-facing: GET availability (so clients watch slots fill in real time).
Super-admin: read/update the policy, override capacity, close/reopen a slot,
manage blackout dates. Super-admin endpoints require a staff session (the same
login behind the Django admin) until the dedicated role-based auth lands.
"""
import json
from datetime import date, datetime, timedelta

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from . import services
from .models import SlotPolicy, BlackoutDate


def _json(request):
    try:
        return json.loads(request.body or b'{}')
    except ValueError:
        return None


def _parse_date(s, default=None):
    if not s:
        return default
    try:
        return datetime.strptime(s, '%Y-%m-%d').date()
    except ValueError:
        return default


def _staff_only(request):
    # Accept a Supabase super-admin (federated identity) or a Django staff session.
    try:
        from backend.accounts.auth import get_portal_user
        pu = get_portal_user(request)
        if pu is not None and pu.is_super_admin:
            return True
    except Exception:
        pass
    user = getattr(request, 'user', None)
    return bool(user and user.is_authenticated and user.is_staff)


# --------------------------- client-facing ---------------------------
def availability(request):
    """GET /api/slots/availability?date_from=&date_to= (defaults: today..+14d)."""
    today = date.today()
    d_from = _parse_date(request.GET.get('date_from'), today)
    d_to = _parse_date(request.GET.get('date_to'), today + timedelta(days=14))
    if d_to < d_from:
        d_to = d_from
    if (d_to - d_from).days > 60:
        d_to = d_from + timedelta(days=60)
    return JsonResponse({'slots': services.get_availability(d_from, d_to)})


# --------------------------- super admin ---------------------------
@csrf_exempt
def policy(request):
    """GET or PUT the active capacity policy."""
    if not _staff_only(request):
        return JsonResponse({'error': 'staff only'}, status=403)
    p = SlotPolicy.get_active()
    if request.method == 'GET':
        return JsonResponse({'name': p.name, 'operating_weekdays': p.operating_weekdays,
                             'windows': p.windows, 'default_capacity': p.default_capacity,
                             'lead_time_minutes': p.lead_time_minutes})
    if request.method in ('PUT', 'POST'):
        data = _json(request)
        if data is None:
            return JsonResponse({'error': 'invalid JSON'}, status=400)
        for field in ('operating_weekdays', 'windows', 'default_capacity', 'lead_time_minutes'):
            if field in data:
                setattr(p, field, data[field])
        p.save()
        return JsonResponse({'status': 'updated'})
    return JsonResponse({'error': 'GET or PUT'}, status=405)


@csrf_exempt
def admin_slots(request):
    """GET ops view of slots for a date range (capacity, booked, status)."""
    if not _staff_only(request):
        return JsonResponse({'error': 'staff only'}, status=403)
    today = date.today()
    d_from = _parse_date(request.GET.get('date_from'), today)
    d_to = _parse_date(request.GET.get('date_to'), today + timedelta(days=14))
    return JsonResponse({'slots': services.get_availability(d_from, d_to)})


@csrf_exempt
def close_slot(request):
    """POST {date, window_key, closed: true|false} - manual close / reopen."""
    if not _staff_only(request):
        return JsonResponse({'error': 'staff only'}, status=403)
    data = _json(request) or {}
    d = _parse_date(data.get('date'))
    if not d or not data.get('window_key'):
        return JsonResponse({'error': 'date and window_key required'}, status=400)
    try:
        slot = services.set_slot_closed(d, data['window_key'], bool(data.get('closed', True)))
    except services.SlotUnavailable as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    return JsonResponse({'date': d.isoformat(), 'window_key': slot.window_key,
                         'status': slot.status, 'remaining': slot.remaining})


@csrf_exempt
def set_capacity(request):
    """POST {date, window_key, capacity} - override a single slot's capacity."""
    if not _staff_only(request):
        return JsonResponse({'error': 'staff only'}, status=403)
    data = _json(request) or {}
    d = _parse_date(data.get('date'))
    if not d or not data.get('window_key') or 'capacity' not in data:
        return JsonResponse({'error': 'date, window_key, capacity required'}, status=400)
    try:
        slot = services.set_slot_capacity(d, data['window_key'], int(data['capacity']))
    except services.SlotUnavailable as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    return JsonResponse({'date': d.isoformat(), 'window_key': slot.window_key,
                         'capacity': slot.capacity, 'status': slot.status,
                         'remaining': slot.remaining})


@csrf_exempt
def blackout(request):
    """GET list, POST {date, reason} to add, DELETE {date} to remove."""
    if not _staff_only(request):
        return JsonResponse({'error': 'staff only'}, status=403)
    if request.method == 'GET':
        rows = list(BlackoutDate.objects.values('date', 'reason'))
        return JsonResponse({'blackouts': rows})
    data = _json(request) or {}
    d = _parse_date(data.get('date'))
    if not d:
        return JsonResponse({'error': 'date required'}, status=400)
    if request.method == 'DELETE':
        BlackoutDate.objects.filter(date=d).delete()
        return JsonResponse({'status': 'removed'})
    BlackoutDate.objects.update_or_create(date=d, defaults={'reason': data.get('reason', '')})
    return JsonResponse({'status': 'added'})
