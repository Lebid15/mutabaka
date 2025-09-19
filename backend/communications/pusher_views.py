from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .pusher_client import pusher_client


@method_decorator(csrf_exempt, name='dispatch')
class MessageAPIView(APIView):
    authentication_classes = []  # demo: open; in real use, add auth
    permission_classes = []

    def post(self, request, *args, **kwargs):
        if pusher_client is None:
            return Response({'ok': False, 'error': 'Pusher not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        data = request.data or {}
        username = (data.get('username') or '').strip()
        message = (data.get('message') or '').strip()
        conversation_id = data.get('conversation_id')
        if not username or not message:
            return Response({'ok': False, 'error': 'username and message required'}, status=status.HTTP_400_BAD_REQUEST)
        channel = 'chat'
        if conversation_id:
            try:
                cid = int(conversation_id)
                channel = f'chat_{cid}'
            except (TypeError, ValueError):
                pass
        payload = {
            'username': username,
            'message': message,
            'conversationId': conversation_id,
        }
        try:
            pusher_client.trigger(channel, 'message', payload)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({'ok': True})
