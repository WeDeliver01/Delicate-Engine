"""
Django settings for backend project.

For production, set environment variables:
- DJANGO_SECRET_KEY: your secret key
- DJANGO_DEBUG: '0' for False, '1' for True
- DJANGO_ALLOWED_HOSTS: comma-separated list of hosts
"""

from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# Security: Load secret key from environment or use fallback for dev
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'h1hu3kb&%&nyvzp7#rpftzex_na!!j4h_rk-e%lbnd_-%c(4jr')

# Debug mode - defaults to False for safety
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'

# Allowed hosts - read from environment or fallback to localhost
# Note: 'testserver' is added so Django's test client can be used in integration checks
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,testserver').split(',')

# Public base URL used when generating shareable client quote links (admin).
# Points at the published site so links open the live client quote experience.
PUBLIC_SITE_URL = os.environ.get('PUBLIC_SITE_URL', 'https://delicatecouriersite.replit.app')

# CORS settings - restrict to known frontend origins in production
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Add production CORS origins if specified
production_origins = os.environ.get('DJANGO_CORS_ALLOWED_ORIGINS')
if production_origins:
    CORS_ALLOWED_ORIGINS.extend(production_origins.split(','))

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'backend.quotes',
    'backend.catalog',
    'backend.scheduling',
    'backend.finance',
    'backend.tracking',
    'backend.accounts',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'

# Database - default SQLite, can override with DATABASE_URL in production
# Database - default SQLite, can override with DATABASE_URL in production (requires dj-database-url)
if os.environ.get('DATABASE_URL'):
    try:
        import dj_database_url
        DATABASES = {
            'default': dj_database_url.parse(os.environ['DATABASE_URL'])
        }
    except ImportError:
        print("Warning: DATABASE_URL set but dj-database-url not installed. Using SQLite.")
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': BASE_DIR / 'db.sqlite3',
            }
        }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Trust the public site domain(s) for CSRF, since the admin is reached through
# the Next.js frontend proxy (the browser's Origin is the main site domain).
CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get(
        'DJANGO_CSRF_TRUSTED_ORIGINS',
        'https://*.replit.dev,https://*.replit.app,https://*.repl.co,'
        'https://delicatecourier.co.za,https://*.delicatecourier.co.za'
    ).split(',') if o.strip()
]

# Login URL for @login_required redirects
LOGIN_URL = '/admin/login/'

# Disable automatic slash redirects for POST requests to avoid 500 errors
APPEND_SLASH = False

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = os.environ.get('DJANGO_TIME_ZONE', 'UTC')
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / "static",                       # existing static folder
    os.path.join(BASE_DIR.parent, "frontend", "public"),  # 👈 add this
]
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Security headers for production
# Note: Replit terminates TLS at the proxy, so SECURE_SSL_REDIRECT is not needed.
# Cookies and CSRF can still be marked secure because the browser sees HTTPS.
if not DEBUG:
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# REST Framework settings with throttling
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',  # Adjust based on expected load
    },
}


# ---------------------------------------------------------------------------
# Finance & event-backbone configuration
#
# All optional. With nothing set, the system runs fully: events and ShipLogic
# calls queue in the outbox and reattempt forever (soft-retry) until you wire
# the real endpoints, and the payment provider runs in 'stub' mode. Set these
# via Replit Secrets / environment when each integration is ready.
# ---------------------------------------------------------------------------

# Financial engine ingest (event-driven push target). Until set, engine events
# stay pending and flush automatically once it is configured.
ENGINE_INGEST_URL = os.environ.get('ENGINE_INGEST_URL', '')
ENGINE_HMAC_SECRET = os.environ.get('ENGINE_HMAC_SECRET', '')
ENGINE_TIMEOUT = float(os.environ.get('ENGINE_TIMEOUT', '10'))

# ShipLogic Admin API (ShipLogic invoices the client).
SHIPLOGIC_API_URL = os.environ.get('SHIPLOGIC_API_URL', 'https://api.shiplogic.com')
SHIPLOGIC_TOKEN = os.environ.get('SHIPLOGIC_TOKEN', '')
SHIPLOGIC_PROVIDER_ID = os.environ.get('SHIPLOGIC_PROVIDER_ID', '')
# The catch-all R0 service level that resolves for any address. Verify it bills
# R0 on the statement before going live (see UPGRADE.md sandbox gate).
SHIPLOGIC_CATCHALL_SERVICE_LEVEL_CODE = os.environ.get('SHIPLOGIC_CATCHALL_SERVICE_LEVEL_CODE', 'SPX')
SHIPLOGIC_TIMEOUT = float(os.environ.get('SHIPLOGIC_TIMEOUT', '15'))

# Payment provider for client top-ups. 'stub' for local/dev, 'bobpay' for live.
PAYMENTS_PROVIDER = os.environ.get('PAYMENTS_PROVIDER', 'stub')
PAYMENTS_API_URL = os.environ.get('PAYMENTS_API_URL', '')
PAYMENTS_API_KEY = os.environ.get('PAYMENTS_API_KEY', '')
PAYMENTS_WEBHOOK_SECRET = os.environ.get('PAYMENTS_WEBHOOK_SECRET', '')
PAYMENTS_RETURN_URL = os.environ.get('PAYMENTS_RETURN_URL', '')
PAYMENTS_WEBHOOK_URL = os.environ.get('PAYMENTS_WEBHOOK_URL', '')
PAYMENTS_TIMEOUT = float(os.environ.get('PAYMENTS_TIMEOUT', '15'))

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'loggers': {'finance.outbox': {'handlers': ['console'], 'level': 'INFO'}},
}

# Liability cover premium as a percent of declared value (0 = none).
LIABILITY_RATE_PERCENT = os.environ.get('LIABILITY_RATE_PERCENT', '0')

SHIPLOGIC_WEBHOOK_SECRET = os.environ.get('SHIPLOGIC_WEBHOOK_SECRET', '')

DAA_SYNC_SECRET = os.environ.get('DAA_SYNC_SECRET', '')

SUPABASE_JWT_SECRET = os.environ.get('SUPABASE_JWT_SECRET', '')

SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', os.environ.get('SUPABASE_URL', ''))

SUPABASE_AUD = os.environ.get('SUPABASE_AUD', 'authenticated')
