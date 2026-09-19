#!/usr/bin/env python
"""Create admin user for Django backend."""
import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
django.setup()

from django.contrib.auth.models import User

# Admin login credentials
username = 'admin'
email = 'admin@delicatecourier.co.za'
password = 'SecureAdminPass2025!'

u, created = User.objects.get_or_create(
    username=username,
    defaults={'email': email, 'is_staff': True, 'is_superuser': True}
)
u.set_password(password)
u.save()

if created:
    print(f"✓ Created admin user: '{username}' with email '{email}'")
else:
    print(f"✓ Updated admin user: '{username}'")
print(f"  Password: {password}")
print("  → Visit http://localhost:8000/admin/ to log in")
print("  → CHANGE PASSWORD after first login!")
