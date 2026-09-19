"""Authenticated portal endpoints, scoped to the caller's client."""
from django.http import JsonResponse

from .decorators import require_portal


@require_portal
def me(request):
    pu = request.portal
    return JsonResponse({
        'email': pu.email, 'role': pu.role,
        'client_id': pu.client_id,
        'client_name': pu.client.name if pu.client_id else None,
        'is_super_admin': pu.is_super_admin})


@require_portal
def my_shipments(request):
    """Caller's own shipments only. A super admin with no client sees nothing here
    (they use the all-shipments view); a client admin sees just their bakery."""
    pu = request.portal
    if not pu.client_id:
        return JsonResponse({'client_id': None, 'count': 0, 'shipments': []})
    from backend.tracking.api import portal_shipments
    return portal_shipments(request, pu.client_id)
