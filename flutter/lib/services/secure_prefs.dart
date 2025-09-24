import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecurePrefs {
  static const _ss = FlutterSecureStorage();
  static const _kRememberPin = 'mutabaka_remember_pin';
  static const _kLastUsername = 'mutabaka_last_username';
  static const _kLastDisplayName = 'mutabaka_last_display_name';

  static Future<void> setRememberPin(bool value) async {
    await _ss.write(key: _kRememberPin, value: value ? '1' : '0');
  }

  static Future<bool> getRememberPin() async {
    final v = await _ss.read(key: _kRememberPin);
    return v == '1';
  }

  static Future<void> setLastUser({required String username, required String displayName}) async {
    await _ss.write(key: _kLastUsername, value: username);
    await _ss.write(key: _kLastDisplayName, value: displayName);
  }

  static Future<(String username, String displayName)?> getLastUser() async {
    final u = await _ss.read(key: _kLastUsername) ?? '';
    final d = await _ss.read(key: _kLastDisplayName) ?? '';
    if (u.isEmpty && d.isEmpty) return null;
    return (u, d);
  }

  static Future<void> clearRememberPinAndUser() async {
    await _ss.delete(key: _kRememberPin);
    await _ss.delete(key: _kLastUsername);
    await _ss.delete(key: _kLastDisplayName);
  }
}
