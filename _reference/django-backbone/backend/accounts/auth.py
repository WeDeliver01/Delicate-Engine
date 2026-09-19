"""
Supabase JWT verification + portal-user resolution.

We validate the HS256 access token Supabase issues (signed with the project's
JWT secret), read the standard claims, and resolve the local PortalUser. Role and
client come from claims the platform's custom access token hook already stamps
(app_role, plus a client/tenant id), so the two systems agree on who someone is.
"""
import jwt
from django.conf import settings


def _map_role(claims) -> str:
    raw = (claims.get('app_role') or claims.get('role') or '').strip().lower()
    if raw in ('superadmin', 'super_admin', 'admin'):
        return 'super_admin'
    return 'client_admin'


def verify_supabase_jwt(token: str):
    secret = getattr(settings, 'SUPABASE_JWT_SECRET', '') or ''
    if not secret or not token:
        return None
    aud = getattr(settings, 'SUPABASE_AUD', 'authenticated')
    try:
        claims = jwt.decode(token, secret, algorithms=['HS256'], audience=aud,
                            options={'verify_aud': bool(aud)})
    except jwt.PyJWTError:
        return None
    issuer = getattr(settings, 'SUPABASE_URL', '') or ''
    if issuer and claims.get('iss') and not str(claims['iss']).startswith(issuer):
        return None
    return claims


def get_portal_user(request):
    """Resolve (and lazily provision) the PortalUser for a request, or None."""
    from .models import PortalUser
    auth = request.headers.get('Authorization', '')
    if not auth.lower().startswith('bearer '):
        return None
    claims = verify_supabase_jwt(auth[7:].strip())
    if not claims or not claims.get('sub'):
        return None

    role = _map_role(claims)
    email = claims.get('email', '') or ''
    client_id = claims.get('client_id') or claims.get('tenant_id')

    pu, _ = PortalUser.objects.get_or_create(
        supabase_user_id=claims['sub'], defaults={'email': email, 'role': role})
    changed = False
    if pu.role != role:
        pu.role, changed = role, True
    if email and pu.email != email:
        pu.email, changed = email, True
    if client_id and not pu.client_id:
        from backend.quotes.models import Client
        if Client.objects.filter(pk=client_id).exists():
            pu.client_id, changed = client_id, True
    if changed:
        pu.save()
    return pu
