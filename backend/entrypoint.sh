#!/usr/bin/env bash
set -euo pipefail

python manage.py collectstatic --noinput || true
python manage.py migrate --noinput

# Use daphne for ASGI (channels)
# Bind to all interfaces so Nginx can reach it on the compose network
exec daphne -b 0.0.0.0 -p 8000 mujard.asgi:application
