import 'package:dio/dio.dart';
import 'dart:io' show Platform;
import 'package:flutter_dotenv/flutter_dotenv.dart';

class ApiClient {
  ApiClient._();

  static final Dio _dio = Dio(_buildOptions());

  static BaseOptions _buildOptions() {
    String raw = (dotenv.env['API_BASE_URL']?.trim() ?? 'http://10.0.2.2:8000');
    try {
      final u = Uri.parse(raw);
      if (Platform.isAndroid && (u.host == '127.0.0.1' || u.host == 'localhost')) {
        raw = u.replace(host: '10.0.2.2').toString();
      }
    } catch (_) {
      // keep raw
    }
    return BaseOptions(
      baseUrl: raw,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      headers: {
        'Accept': 'application/json',
        // Enable mobile-specific flows on the backend (PIN/devices)
        'X-Client': 'mobile',
      },
    );
  }

  static Dio get dio => _dio;
}
