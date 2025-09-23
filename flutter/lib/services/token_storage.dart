import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredTokens {
  final String access;
  final String refresh;
  const StoredTokens({required this.access, required this.refresh});
}

abstract class TokenStorage {
  Future<void> save(StoredTokens tokens);
  Future<StoredTokens?> load();
  Future<void> clear();
}

/// Simple in-memory storage used for local development when secure storage
/// is not available (offline Android Maven, etc.).
class MemoryTokenStorage implements TokenStorage {
  static String? _access;
  static String? _refresh;

  @override
  Future<void> save(StoredTokens tokens) async {
    _access = tokens.access;
    _refresh = tokens.refresh;
  }

  @override
  Future<StoredTokens?> load() async {
    final a = _access;
    final r = _refresh;
    if (a != null && a.isNotEmpty && r != null && r.isNotEmpty) {
      return StoredTokens(access: a, refresh: r);
    }
    return null;
  }

  @override
  Future<void> clear() async {
    _access = null;
    _refresh = null;
  }
}

/// Secure storage using platform keystore/keychain, persisted across app restarts.
class SecureTokenStorage implements TokenStorage {
  static const _kAccess = 'mutabaka_access';
  static const _kRefresh = 'mutabaka_refresh';
  final FlutterSecureStorage _ss = const FlutterSecureStorage();

  @override
  Future<void> save(StoredTokens tokens) async {
    await _ss.write(key: _kAccess, value: tokens.access);
    await _ss.write(key: _kRefresh, value: tokens.refresh);
  }

  @override
  Future<StoredTokens?> load() async {
    final a = await _ss.read(key: _kAccess);
    final r = await _ss.read(key: _kRefresh);
    if ((a ?? '').isNotEmpty && (r ?? '').isNotEmpty) {
      return StoredTokens(access: a!, refresh: r!);
    }
    return null;
  }

  @override
  Future<void> clear() async {
    await _ss.delete(key: _kAccess);
    await _ss.delete(key: _kRefresh);
  }
}
