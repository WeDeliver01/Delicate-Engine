#!/bin/sh
# Creates the integration-test database alongside the dev one on first boot.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE DATABASE delicate_test OWNER delicate;"
