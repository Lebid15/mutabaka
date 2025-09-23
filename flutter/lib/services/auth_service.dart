import 'package:dio/dio.dart';

import '../api_client.dart';
import '../models/user_me.dart';
import 'token_storage.dart';
import 'session.dart';

class AuthTokens {
  final String access;
  final String refresh;
  const AuthTokens({required this.access, required this.refresh});
}

class AuthResult {
  final AuthTokens tokens;
  final UserMe me;
  // PIN-related flags
  final bool requiresPin;
  final String? showGeneratedPinOnce;
  const AuthResult({required this.tokens, required this.me, this.requiresPin = false, this.showGeneratedPinOnce});
}

class OtpRequiredError implements Exception {
  final String message;
  OtpRequiredError([this.message = 'OTP required']);
  @override
  String toString() => 'OtpRequiredError: $message';
}

class AuthService {
  final TokenStorage _storage;
  AuthService({TokenStorage? storage}) : _storage = storage ?? SecureTokenStorage();

  final Dio _dio = ApiClient.dio;

  Future<AuthResult> login({
    required String identifier,
    required String password,
    String? otp,
    bool remember = false,
    // Device fingerprint info
    String? fingerprint,
    String? deviceName,
    String? platform,
  }) async {
    try {
      final payload = <String, dynamic>{
        // Backend accepts either username or email; send both for clarity
        'username': identifier,
        'email': identifier,
        'password': password,
        if (otp != null && otp.isNotEmpty) 'otp': otp,
      };
      final resp = await _dio.post(
        '/api/auth/token/',
        data: payload,
        options: Options(headers: {
          'Content-Type': 'application/json',
        }),
      );
      final data = resp.data as Map;
      final access = (data['access'] ?? '').toString();
      final refresh = (data['refresh'] ?? '').toString();
      final pinOnce = (data['pin']?.toString().isNotEmpty ?? false) ? data['pin'].toString() : null;
      final pinRequired = data['pin_required'] == true;
      if (access.isEmpty || refresh.isEmpty) {
        throw Exception('Invalid token response');
      }

      // Fetch /api/auth/me using the access token
      final meResp = await _dio.get(
        '/api/auth/me/',
        options: Options(headers: {
          'Authorization': 'Bearer $access',
        }),
      );
      final me = UserMe.fromJson((meResp.data as Map).cast<String, dynamic>());

      final tokens = AuthTokens(access: access, refresh: refresh);
      // Persist tokens securely so we can resume session and do PIN-only next time
      await _persistTokens(tokens);
      Session.I.setAuth(access: access, refresh: refresh, me: me);
      // If we have fingerprint and platform, register device after login (may be auto-approved)
      if (fingerprint != null && fingerprint.isNotEmpty) {
        try {
          await _dio.post(
            '/api/devices/register',
            data: {
              'fingerprint': fingerprint,
              if (deviceName != null) 'device_name': deviceName,
              if (platform != null) 'platform': platform,
            },
            options: Options(headers: {
              'Authorization': 'Bearer $access',
              'Content-Type': 'application/json',
            }),
          );
        } catch (_) {
          // ignore device register errors to not block login
        }
      }
      return AuthResult(tokens: tokens, me: me, requiresPin: pinRequired, showGeneratedPinOnce: pinOnce);
    } on DioException catch (e) {
      final status = e.response?.statusCode ?? 0;
      final body = (e.response?.data is Map)
          ? (e.response!.data as Map)
          : const {};
      if (status == 400 && (body['otp_required'] == true)) {
        throw OtpRequiredError(body['detail']?.toString() ?? 'OTP required');
      }
      final msg = body['detail']?.toString() ?? 'بيانات غير صحيحة';
      throw Exception(msg);
    }
  }

  Future<void> _persistTokens(AuthTokens t) async {
    await _storage.save(StoredTokens(access: t.access, refresh: t.refresh));
  }

  Future<AuthTokens?> loadTokens() async {
    final s = await _storage.load();
    if (s != null) {
      return AuthTokens(access: s.access, refresh: s.refresh);
    }
    return null;
  }

  Future<void> clearTokens() async {
    await _storage.clear();
  }

  Future<AuthTokens> refreshToken(String refreshToken) async {
    final resp = await _dio.post(
      '/api/auth/token/refresh/',
      data: {'refresh': refreshToken},
      options: Options(headers: {'Content-Type': 'application/json'}),
    );
    final data = resp.data as Map;
    final access = (data['access'] ?? '').toString();
    final refresh = (data['refresh'] ?? refreshToken).toString();
    final tokens = AuthTokens(access: access, refresh: refresh);
    await _persistTokens(tokens);
    // Keep session updated
    final me = Session.I.currentUser;
    if (me != null) {
      Session.I.setAuth(access: access, refresh: refresh, me: me);
    }
    return tokens;
  }

  Future<void> verifyPin({required String pin, String? fingerprint, String? deviceName, String? platform}) async {
    final access = Session.I.accessToken;
    if (access == null || access.isEmpty) throw Exception('No access token');
    try {
      await _dio.post(
        '/api/auth/verify-pin',
        data: {
          'pin': pin,
          if (fingerprint != null) 'fingerprint': fingerprint,
          if (deviceName != null) 'device_name': deviceName,
          if (platform != null) 'platform': platform,
        },
        options: Options(headers: {
          'Authorization': 'Bearer $access',
          'Content-Type': 'application/json',
        }),
      );
    } on DioException catch (e) {
      final body = (e.response?.data is Map) ? (e.response!.data as Map) : const {};
      final msg = body['detail']?.toString() ?? 'تعذر التحقق من PIN';
      throw Exception(msg);
    }
  }
}
