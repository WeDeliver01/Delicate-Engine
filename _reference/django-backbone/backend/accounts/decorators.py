"""Auth gates for portal endpoints, built on the Supabase identity."""
from functools import wraps

from django.http import JsonResponse

from .auth import get_portal_user


def require_portal(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        pu = get_portal_user(request)
        if pu is None:
            return JsonResponse({'error': 'authentication required'}, status=401)
        request.portal = pu
        return view(request, *args, **kwargs)
    return wrapper


def require_super_admin(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        pu = get_portal_user(request)
        if pu is None:
            return JsonResponse({'error': 'authentication required'}, status=401)
        if not pu.is_super_admin:
            return JsonResponse({'error': 'super admin only'}, status=403)
        request.portal = pu
        return view(request, *args, **kwargs)
    return wrapper
