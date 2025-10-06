import jwt
from urllib.parse import parse_qs
from django.conf import settings
from channels.auth import AuthMiddlewareStack
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from asgiref.sync import sync_to_async

User = get_user_model()

class JWTQueryAuthMiddleware(BaseMiddleware):
    """Extracts ?token=<JWT> from query string and authenticates scope['user'].
    Falls back to existing session user if no token provided."""
    async def __call__(self, scope, receive, send):
        query = scope.get('query_string', b'').decode()
        print(f"[WS AUTH] Query string: {query[:200]}")  # Debug log
        params = parse_qs(query)
        token_list = params.get('token')
        print(f"[WS AUTH] Token from query: {token_list[0][:50] if token_list else 'NONE'}")  # Debug log
        if token_list:
            raw = token_list[0]
            try:
                UntypedToken(raw)  # validate signature & expiry
                data = jwt.decode(raw, settings.SIMPLE_JWT['SIGNING_KEY'] if 'SIGNING_KEY' in settings.SIMPLE_JWT else settings.SECRET_KEY, algorithms=[settings.SIMPLE_JWT.get('ALGORITHM','HS256')])
                user_id = data.get('user_id')
                if user_id:
                    user = await sync_to_async(User.objects.get)(id=user_id)
                    scope['user'] = user
                    print(f"[WS AUTH] ✅ Authenticated user: {user.username} (ID: {user.id})")  # Debug log
                # Expose token payload so consumers can read team_member_id
                scope['token_payload'] = data
            except (InvalidToken, TokenError, User.DoesNotExist, jwt.PyJWTError) as e:
                # On invalid token we override user to Anonymous to prevent leakage
                print(f"[WS AUTH] ❌ Auth failed: {type(e).__name__}: {str(e)[:100]}")  # Debug log
                from django.contrib.auth.models import AnonymousUser
                scope['user'] = AnonymousUser()
        else:
            print(f"[WS AUTH] ⚠️ No token in query string!")  # Debug log
        return await super().__call__(scope, receive, send)

def JWTAuthMiddlewareStack(inner):
    return JWTQueryAuthMiddleware(AuthMiddlewareStack(inner))
