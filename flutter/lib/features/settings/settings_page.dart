import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:audioplayers/audioplayers.dart';

import '../../api_client.dart';
import '../../services/session.dart';
import '../../services/device_fingerprint.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final Dio _dio = ApiClient.dio;

  // Sound
  bool _soundEnabled = true;
  final _player = AudioPlayer();

  // TOTP
  bool _totpEnabled = false;
  bool _totpBusy = false;
  String? _totpSecret;
  String? _otpUri;
  final _otpCtrl = TextEditingController();

  bool _pushSupported = false; // browsers only; on mobile we don't implement now
  bool _pushEnabled = false;   // placeholder UI
  bool _busyPush = false;

  @override
  void initState() {
    super.initState();
    _load();
    // Preload trusted devices list
    _loadDevices();
  }

  @override
  void dispose() {
    _otpCtrl.dispose();
    _player.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    // Sound pref
    final sp = await SharedPreferences.getInstance();
    setState(() => _soundEnabled = sp.getBool('notify_sound_enabled') ?? true);
    // TOTP status
    final token = Session.I.accessToken;
    if (token != null && token.isNotEmpty) {
      try {
        final r = await _dio.get('/api/auth/totp/status', options: Options(headers: {'Authorization': 'Bearer $token'}));
        final data = (r.data as Map).cast<String, dynamic>();
        setState(() => _totpEnabled = data['enabled'] == true);
      } catch (_) {}
    }
  }

  // Trusted devices
  List<Map<String, dynamic>> _devices = const [];
  String? _currentFp;
  bool _loadingDevices = false;

  Future<void> _loadDevices() async {
    setState(() => _loadingDevices = true);
    try {
      final token = Session.I.accessToken;
      if (token == null) return;
      final did = await DeviceFingerprintService.getIdentity();
      _currentFp = did.fingerprint;
      final r = await _dio.get('/api/devices/list', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = (r.data as Map).cast<String, dynamic>();
      final items = (data['devices'] as List).cast<Map>().map((e) => e.cast<String, dynamic>()).toList();
      setState(() => _devices = items);
    } catch (_) {
      // ignore
    } finally {
      if (mounted) setState(() => _loadingDevices = false);
    }
  }

  Future<void> _approveDevice(int id) async {
    final token = Session.I.accessToken;
    if (token == null) return;
    try {
      await _dio.post('/api/devices/approve', data: {'id': id}, options: Options(headers: {'Authorization': 'Bearer $token'}));
      await _loadDevices();
    } catch (_) {}
  }

  Future<void> _deleteDevice(int id) async {
    final token = Session.I.accessToken;
    if (token == null) return;
    try {
      await _dio.delete('/api/devices/$id', options: Options(headers: {'Authorization': 'Bearer $token'}));
      await _loadDevices();
    } catch (_) {}
  }

  Future<void> _toggleSound() async {
    final sp = await SharedPreferences.getInstance();
    final next = !_soundEnabled;
    await sp.setBool('notify_sound_enabled', next);
    setState(() => _soundEnabled = next);
  }

  Future<void> _testSound() async {
    // Try to fetch backend-configured sound URL (like the web does)
    try {
      final r = await _dio.get('/api/notification/sound');
      final data = (r.data as Map?)?.cast<String, dynamic>() ?? {};
      final url = (data['sound_url'] is String && (data['sound_url'] as String).isNotEmpty) ? data['sound_url'] as String : null;
      if (url != null) {
        await _player.play(UrlSource(url));
        return;
      }
    } catch (_) {}
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('لا توجد نغمة مخصّصة من الخادم')));
    }
  }

  Future<void> _setupTotp() async {
    final token = Session.I.accessToken;
    if (token == null) return;
    setState(() => _totpBusy = true);
    try {
      final r = await _dio.post('/api/auth/totp/setup', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = (r.data as Map).cast<String, dynamic>();
      setState(() {
        _totpSecret = data['secret']?.toString();
        _otpUri = data['otpauth_uri']?.toString();
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إنشاء المفتاح')));
      }
    } finally {
      if (mounted) setState(() => _totpBusy = false);
    }
  }

  Future<void> _enableTotp() async {
    final token = Session.I.accessToken;
    if (token == null) return;
    final code = _otpCtrl.text.trim();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('أدخل رمزاً من 6 أرقام')));
      return;
    }
    try {
      final r = await _dio.post('/api/auth/totp/enable', data: {'otp': code}, options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = (r.data as Map).cast<String, dynamic>();
      final ok = data['enabled'] == true;
      if (ok) {
        setState(() => _totpEnabled = true);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم تفعيل المصادقة الثنائية')));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر التفعيل')));
    }
  }

  Future<void> _disableTotp() async {
    final token = Session.I.accessToken;
    if (token == null) return;
    final code = _otpCtrl.text.trim();
    if (code.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('أدخل رمزاً من 6 أرقام')));
      return;
    }
    try {
      final r = await _dio.post('/api/auth/totp/disable', data: {'otp': code}, options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = (r.data as Map).cast<String, dynamic>();
      final stillEnabled = data['enabled'] == true;
      setState(() {
        _totpEnabled = stillEnabled;
        if (!stillEnabled) {
          _totpSecret = null;
          _otpUri = null;
        }
      });
      if (!stillEnabled) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إلغاء التفعيل')));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر الإلغاء')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final divider = const Color(0xFF24343B);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B141A),
        appBar: AppBar(
          backgroundColor: const Color(0xFF111B21),
          title: const Text('الإعدادات'),
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              _Section(
                title: 'الأمان: المصادقة الثنائية (TOTP)',
                subtitle: 'تعمل مع Google Authenticator أو تطبيقات مشابهة.',
                trailing: _totpEnabled
                    ? const Text('مفعّلة', style: TextStyle(color: Color(0xFF34D399), fontSize: 12))
                    : const Text('غير مفعّلة', style: TextStyle(color: Colors.white60, fontSize: 12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        if (!_totpEnabled)
                          FilledButton(
                            onPressed: _totpBusy ? null : _setupTotp,
                            child: Text(_totpBusy ? 'جارٍ…' : 'إنشاء مفتاح وQR'),
                          ),
                        if (_totpEnabled) ...[
                          SizedBox(
                            width: 180,
                            child: TextField(
                              controller: _otpCtrl,
                              decoration: const InputDecoration(hintText: 'رمز 6 أرقام'),
                              keyboardType: TextInputType.number,
                              maxLength: 6,
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            style: FilledButton.styleFrom(backgroundColor: Colors.red),
                            onPressed: _disableTotp,
                            child: const Text('إلغاء التفعيل'),
                          ),
                        ],
                      ],
                    ),
                    if (_otpUri != null || _totpSecret != null) ...[
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: (_otpUri != null)
                                ? QrImageView(
                                    data: _otpUri!,
                                    size: 180,
                                    backgroundColor: Colors.white,
                                  )
                                : const SizedBox.shrink(),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Secret:', style: TextStyle(color: Colors.white70, fontSize: 12)),
                                const SizedBox(height: 4),
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF111B21),
                                    border: Border.all(color: divider),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(_totpSecret ?? '', style: const TextStyle(color: Colors.white, fontSize: 12)),
                                ),
                                const SizedBox(height: 8),
                                if (!_totpEnabled) Row(
                                  children: [
                                    SizedBox(
                                      width: 180,
                                      child: TextField(
                                        controller: _otpCtrl,
                                        decoration: const InputDecoration(hintText: 'أدخل رمز 6 أرقام'),
                                        keyboardType: TextInputType.number,
                                        maxLength: 6,
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    FilledButton(onPressed: _enableTotp, child: const Text('تفعيل')),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              _Section(
                title: 'تشغيل صوت الإشعار',
                subtitle: 'عند وصول رسالة جديدة والتبويب غير مُركّز أو محادثة أخرى مفتوحة.',
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FilledButton(
                      onPressed: _toggleSound,
                      style: FilledButton.styleFrom(backgroundColor: _soundEnabled ? const Color(0xFF059669) : const Color(0xFF4B5563)),
                      child: Text(_soundEnabled ? 'مفعّل' : 'متوقف'),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(onPressed: _testSound, child: const Text('تجربة الصوت')),
                  ],
                ),
              ),

              _Section(
                title: 'إشعارات الرسائل (Push)',
                subtitle: 'يتطلب تهيئة على الجهاز. (غير مفعّل على Flutter حالياً)',
                trailing: _pushSupported
                    ? (_pushEnabled
                        ? FilledButton(
                            style: FilledButton.styleFrom(backgroundColor: Colors.red),
                            onPressed: _busyPush ? null : () async { setState(() => _busyPush = true); await Future.delayed(const Duration(milliseconds: 300)); setState(() { _pushEnabled = false; _busyPush = false; }); },
                            child: const Text('إيقاف'),
                          )
                        : FilledButton(onPressed: _busyPush ? null : () async { setState(() => _busyPush = true); await Future.delayed(const Duration(milliseconds: 300)); setState(() { _pushEnabled = true; _busyPush = false; }); }, child: const Text('تفعيل')))
                    : const Text('غير مدعوم', style: TextStyle(color: Colors.white60, fontSize: 12)),
              ),

              _Section(
                title: 'الأجهزة الموثوقة',
                subtitle: 'حد أقصى جهازين. يمكنك إزالة جهاز أو الموافقة عليه.',
                trailing: OutlinedButton.icon(
                  onPressed: _loadingDevices ? null : _loadDevices,
                  icon: _loadingDevices ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.refresh),
                  label: const Text('تحديث'),
                ),
                child: _devices.isEmpty
                    ? const Text('لا توجد أجهزة')
                    : Column(
                        children: _devices.map((d) {
                          final id = d['id'] as int;
                          final fp = (d['fingerprint'] ?? '').toString();
                          final name = (d['device_name'] ?? '').toString();
                          final platform = (d['platform'] ?? '').toString();
                          final approved = d['approved_at'] != null;
                          final isCurrent = _currentFp != null && fp == _currentFp;
                          return ListTile(
                            title: Text(name.isEmpty ? 'بدون اسم' : name, style: const TextStyle(color: Colors.white)),
                            subtitle: Text('$platform — ${fp.substring(0, 8)}…', style: const TextStyle(color: Colors.white60, fontSize: 12)),
                            leading: Icon(approved ? Icons.verified_user : Icons.hourglass_top, color: approved ? const Color(0xFF34D399) : Colors.orange),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (!approved) IconButton(onPressed: () => _approveDevice(id), tooltip: 'موافقة', icon: const Icon(Icons.check, color: Colors.white)),
                                if (!isCurrent) IconButton(onPressed: () => _deleteDevice(id), tooltip: 'إزالة', icon: const Icon(Icons.delete_outline, color: Colors.redAccent)),
                                if (isCurrent) const Padding(
                                  padding: EdgeInsets.symmetric(horizontal: 8.0),
                                  child: Text('الجهاز الحالي', style: TextStyle(color: Colors.white70, fontSize: 12)),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget trailing;
  final Widget? child;
  const _Section({required this.title, required this.subtitle, required this.trailing, this.child});

  @override
  Widget build(BuildContext context) {
    final divider = const Color(0xFF24343B);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF111B21),
        border: Border.all(color: divider),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(color: Colors.white60, fontSize: 12)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              trailing,
            ],
          ),
          if (child != null) ...[
            const SizedBox(height: 10),
            child!,
          ],
        ],
      ),
    );
  }
}
