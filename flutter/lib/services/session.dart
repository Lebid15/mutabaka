import '../models/user_me.dart';
import 'dart:convert' show utf8, jsonDecode, base64Url;

class Session {
  Session._();
  static final Session I = Session._();

  String? accessToken;
  String? refreshToken;
  UserMe? currentUser;

  bool get isAuthenticated => (accessToken != null && accessToken!.isNotEmpty);

  void setAuth({required String access, required String refresh, required UserMe me}) {
    accessToken = access;
    refreshToken = refresh;
    currentUser = me;
  }

  void clear() {
    accessToken = null;
    refreshToken = null;
    currentUser = null;
  }

  // Helper: check if current token represents a team member actor (like web frontend)
  bool get isTeamActor {
    final tok = accessToken;
    if (tok == null || tok.isEmpty) return false;
    try {
      final parts = tok.split('.');
      if (parts.length < 2) return false;
      final payloadB64 = parts[1];
      // Normalize base64 padding for URL-safe tokens
      final padLen = (4 - (payloadB64.length % 4)) % 4;
      final normalized = payloadB64 + ('=' * padLen);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final map = jsonDecode(decoded) as Map<String, dynamic>;
      final actor = (map['actor'] ?? map['act'] ?? '').toString();
      return actor == 'team_member';
    } catch (_) {
      return false;
    }
  }
}
