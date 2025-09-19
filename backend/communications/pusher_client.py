import os
import pusher

PUSHER_APP_ID = os.environ.get('PUSHER_APP_ID')
PUSHER_KEY = os.environ.get('PUSHER_KEY')
PUSHER_SECRET = os.environ.get('PUSHER_SECRET')
PUSHER_CLUSTER = os.environ.get('PUSHER_CLUSTER', 'eu')

if not (PUSHER_APP_ID and PUSHER_KEY and PUSHER_SECRET and PUSHER_CLUSTER):
    # Avoid crashing if not configured in this environment; you can assert in production
    pusher_client = None
else:
    pusher_client = pusher.Pusher(
        app_id=PUSHER_APP_ID,
        key=PUSHER_KEY,
        secret=PUSHER_SECRET,
        cluster=PUSHER_CLUSTER,
        ssl=True,
    )
