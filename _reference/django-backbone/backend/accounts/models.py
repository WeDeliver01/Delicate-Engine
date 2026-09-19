"""
Portal identity, federated on Supabase.

Authentication is Supabase Auth (same identity provider the API platform uses),
so a bakery signs in once across the whole estate. Supabase issues the JWT; this
table is the local mapping from a Supabase user to OUR client (the bakery) and a
portal role. It is the join between the shared identity provider and the portal's
own data, exactly like the platform's public."User" row maps a Supabase user to a
tenant + app_role.
"""
from django.db import models

ROLES = [
    ('client_admin', 'Client admin'),     # a bakery managing its own portal
    ('super_admin', 'Super admin'),        # Delicate staff, sees everything
]


class PortalUser(models.Model):
    supabase_user_id = models.CharField(max_length=64, unique=True, db_index=True)
    email = models.EmailField(blank=True)
    # The bakery this user belongs to. Null for Delicate super admins.
    client = models.ForeignKey('quotes.Client', null=True, blank=True,
                               on_delete=models.PROTECT, related_name='portal_users')
    role = models.CharField(max_length=20, choices=ROLES, default='client_admin')
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(auto_now=True)

    @property
    def is_super_admin(self):
        return self.role == 'super_admin'

    def __str__(self):
        return f"PortalUser({self.email or self.supabase_user_id}, {self.role})"
