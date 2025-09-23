import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class DeviceIdentity {
  final String fingerprint;
  final String name;
  final String platform;
  const DeviceIdentity({required this.fingerprint, required this.name, required this.platform});
}

class DeviceFingerprintService {
  static const _storage = FlutterSecureStorage();
  static const _key = 'mutabaka_device_fp_v1';

  static Future<DeviceIdentity> getIdentity() async {
    // Try load persisted fingerprint first
    var fp = await _storage.read(key: _key);
    final info = await DeviceInfoPlugin().deviceInfo;
    final map = info.data;
    final platform = _platformName(map);
    final name = _deviceName(map);
    if (fp == null || fp.isEmpty) {
      // Generate a stable-ish hash using some device properties
      final raw = '${platform}|${name}|${map['model'] ?? ''}|${map['id'] ?? ''}|${map['machine'] ?? ''}|${map['fingerprint'] ?? ''}';
      fp = sha256.convert(utf8.encode(raw)).toString();
      await _storage.write(key: _key, value: fp);
    }
    return DeviceIdentity(fingerprint: fp, name: name, platform: platform);
  }

  static String _platformName(Map<String, Object?> m) {
    if (m.containsKey('version') && m.containsKey('brand')) return 'android';
    if (m.containsKey('utsname') && m.containsKey('name')) return 'ios';
    if (m.containsKey('computerName')) return 'windows';
    return defaultTargetPlatform.name;
  }

  static String _deviceName(Map<String, Object?> m) {
    final candidates = [
      m['model']?.toString(),
      m['name']?.toString(),
      m['device']?.toString(),
      m['machine']?.toString(),
      m['computerName']?.toString(),
    ];
    return candidates.firstWhere((e) => e != null && e.trim().isNotEmpty, orElse: () => 'My device')!;
  }
}
