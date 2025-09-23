import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../api_client.dart';
import '../../services/session.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  final Dio _dio = ApiClient.dio;
  Map<String, dynamic>? _me;
  bool _loading = false;
  bool _saving = false;
  String? _msg;
  String? _err;

  final _firstCtrl = TextEditingController();
  final _lastCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _oldPwCtrl = TextEditingController();
  final _newPwCtrl = TextEditingController();
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _loadMe();
  }

  @override
  void dispose() {
    _firstCtrl.dispose();
    _lastCtrl.dispose();
    _phoneCtrl.dispose();
    _oldPwCtrl.dispose();
    _newPwCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadMe() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    setState(() { _loading = true; _err = null; _msg = null; });
    try {
      final resp = await _dio.get('/api/auth/me/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final m = (resp.data as Map).cast<String, dynamic>();
      _me = m;
      _firstCtrl.text = (m['first_name'] ?? '').toString();
      _lastCtrl.text = (m['last_name'] ?? '').toString();
      _phoneCtrl.text = (m['phone'] ?? '').toString();
      setState(() {});
    } catch (_) {
      setState(() { _err = 'تعذر تحميل المعلومات'; });
    } finally { setState(() { _loading = false; }); }
  }

  Future<void> _saveProfile() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    setState(() { _saving = true; _msg = null; _err = null; });
    try {
      final resp = await _dio.patch(
        '/api/auth/me/',
        data: {
          'first_name': _firstCtrl.text.trim(),
          'last_name': _lastCtrl.text.trim(),
          'phone': _phoneCtrl.text.trim(),
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final m = (resp.data as Map).cast<String, dynamic>();
      _me = m;
      _msg = 'تم الحفظ';
      // Keep Session currentUser in sync if present
      final me = Session.I.currentUser;
      if (me != null) {
        Session.I.setAuth(
          access: Session.I.accessToken ?? '',
          refresh: Session.I.refreshToken ?? '',
          me: me,
        );
      }
    } on DioException catch (e) {
      final data = e.response?.data;
      setState(() { _err = (data is Map ? data['detail']?.toString() : null) ?? 'فشل الحفظ'; });
    } catch (_) {
      setState(() { _err = 'فشل الحفظ'; });
    } finally { setState(() { _saving = false; }); }
  }

  Future<void> _changePassword() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    if (_oldPwCtrl.text.isEmpty || _newPwCtrl.text.isEmpty) {
      setState(() { _err = 'يرجى إدخال كلمة المرور الحالية والجديدة'; });
      return;
    }
    setState(() { _saving = true; _msg = null; _err = null; });
    try {
      final resp = await _dio.post(
        '/api/auth/me/?action=change_password',
        data: {
          'old_password': _oldPwCtrl.text,
          'new_password': _newPwCtrl.text,
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if ((resp.statusCode ?? 200) >= 200 && (resp.statusCode ?? 200) < 300) {
        setState(() { _msg = 'تم تغيير كلمة السر'; _oldPwCtrl.clear(); _newPwCtrl.clear(); });
      } else {
        setState(() { _err = 'فشل تغيير كلمة السر'; });
      }
    } on DioException catch (e) {
      final data = e.response?.data;
      setState(() { _err = (data is Map ? data['detail']?.toString() : null) ?? 'فشل تغيير كلمة السر'; });
    } catch (_) {
      setState(() { _err = 'فشل تغيير كلمة السر'; });
    } finally { setState(() { _saving = false; }); }
  }

  Future<void> _pickAndUploadPhoto() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    final res = await FilePicker.platform.pickFiles(type: FileType.image, allowMultiple: false);
    if (res == null || res.files.isEmpty) return;
    final f = res.files.first;
    final path = f.path;
    if (path == null || path.isEmpty) return;
    setState(() { _uploading = true; _msg = null; _err = null; });
    try {
      final form = FormData.fromMap({
        'action': 'upload_logo',
        'logo': await MultipartFile.fromFile(path, filename: f.name),
      });
      final resp = await _dio.post(
        '/api/auth/me/',
        data: form,
        options: Options(headers: {'Authorization': 'Bearer $token', 'Content-Type': 'multipart/form-data'}),
      );
      final m = (resp.data as Map).cast<String, dynamic>();
      setState(() {
        _me = {...?_me, ...m};
        _msg = 'تم تحديث الصورة';
      });
    } on DioException catch (e) {
      final data = e.response?.data;
      setState(() { _err = (data is Map ? data['detail']?.toString() : null) ?? 'فشل رفع الصورة'; });
    } catch (_) {
      setState(() { _err = 'فشل رفع الصورة'; });
    } finally { setState(() { _uploading = false; }); }
  }

  @override
  Widget build(BuildContext context) {
    final divider = const Color(0xFF24343B);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B141A),
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: SafeArea(
            bottom: false,
            child: Container(
              decoration: const BoxDecoration(color: Color(0xFF111B21), border: Border(bottom: BorderSide(color: Color(0xFF24343B))))
              , padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white70, size: 18),
                    tooltip: 'رجوع',
                  ),
                  const SizedBox(width: 6),
                  const Text('بروفايلي', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
        ),
        body: Center(
          child: Container(
            constraints: const BoxConstraints(maxWidth: 800),
            margin: const EdgeInsets.all(12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFF111B21), border: Border.all(color: divider), borderRadius: BorderRadius.circular(10)),
            child: _loading
                ? const Align(alignment: Alignment.centerRight, child: Text('جاري التحميل…', style: TextStyle(color: Colors.white60, fontSize: 12)))
                : (_me == null)
                    ? const Align(alignment: Alignment.centerRight, child: Text('لا توجد بيانات', style: TextStyle(color: Colors.white60, fontSize: 12)))
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (_msg != null || _err != null)
                            Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: _err != null ? const Color(0x66B91C1C) : const Color(0x6638A169),
                                border: Border.all(color: _err != null ? const Color(0xFFEF4444) : const Color(0xFF22C55E)),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(_err ?? _msg!, style: const TextStyle(color: Colors.white, fontSize: 12)),
                            ),

                          // Avatar + upload
                          Row(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(999),
                                child: Container(
                                  width: 64,
                                  height: 64,
                                  decoration: BoxDecoration(color: const Color(0xFF374151), border: Border.all(color: divider)),
                                  child: (_me!['logo_url'] != null && (_me!['logo_url'] as String).isNotEmpty)
                                      ? Image.network(_me!['logo_url'], fit: BoxFit.cover)
                                      : Center(
                                          child: Text(
                                            ((_me!['initials'] ?? _me!['username']?.toString().substring(0, 2) ?? 'U').toString()).toUpperCase(),
                                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                                          ),
                                        ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              OutlinedButton(
                                onPressed: _uploading ? null : _pickAndUploadPhoto,
                                style: ButtonStyle(backgroundColor: const MaterialStatePropertyAll(Color(0x0DFFFFFF))),
                                child: Text(_uploading ? 'جاري الرفع…' : 'تغيير صورة البروفايل', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),

                          // Form grid
                          LayoutBuilder(builder: (context, c) {
                            final isWide = c.maxWidth >= 520;
                            return Wrap(
                              spacing: 12,
                              runSpacing: 10,
                              children: [
                                _LabeledField(label: 'الاسم الأول', controller: _firstCtrl, enabled: true),
                                _LabeledField(label: 'الاسم الأخير', controller: _lastCtrl, enabled: true),
                                _LabeledField(label: 'اسم المستخدم', value: (_me!['username'] ?? '').toString(), enabled: false),
                                _LabeledField(label: 'البريد الإلكتروني', value: (_me!['email'] ?? '').toString(), enabled: false),
                                _LabeledField(label: 'رقم الجوال', controller: _phoneCtrl, enabled: true),
                                _LabeledField(label: 'مدة الإشتراك المتبقية', value: '${_me!['subscription_remaining_days'] ?? 0} يوم', enabled: false),
                              ].map((w) => SizedBox(width: isWide ? (c.maxWidth - 12) / 2 : c.maxWidth, child: w)).toList(),
                            );
                          }),
                          const SizedBox(height: 10),
                          Align(
                            alignment: Alignment.centerRight,
                            child: FilledButton(
                              onPressed: _saving ? null : _saveProfile,
                              style: const ButtonStyle(backgroundColor: MaterialStatePropertyAll(Color(0xFF16A34A))),
                              child: Text(_saving ? '...' : 'حفظ'),
                            ),
                          ),

                          const Divider(height: 24, color: Color(0x6624343B)),
                          LayoutBuilder(builder: (context, c) {
                            final isWide = c.maxWidth >= 520;
                            return Wrap(
                              spacing: 12,
                              runSpacing: 10,
                              children: [
                                _LabeledField(label: 'كلمة السر الحالية', controller: _oldPwCtrl, enabled: true, obscure: true),
                                _LabeledField(label: 'كلمة السر الجديدة', controller: _newPwCtrl, enabled: true, obscure: true),
                              ].map((w) => SizedBox(width: isWide ? (c.maxWidth - 12) / 2 : c.maxWidth, child: w)).toList(),
                            );
                          }),
                          const SizedBox(height: 6),
                          Align(
                            alignment: Alignment.centerRight,
                            child: FilledButton(
                              onPressed: _saving ? null : _changePassword,
                              style: const ButtonStyle(backgroundColor: MaterialStatePropertyAll(Color(0xFF2563EB))),
                              child: Text(_saving ? '...' : 'تغيير كلمة السر'),
                            ),
                          ),
                        ],
                      ),
          ),
        ),
      ),
    );
  }
}

class _LabeledField extends StatelessWidget {
  final String label;
  final TextEditingController? controller;
  final String? value;
  final bool enabled;
  final bool obscure;
  const _LabeledField({required this.label, this.controller, this.value, required this.enabled, this.obscure = false});

  @override
  Widget build(BuildContext context) {
    final base = InputDecoration(
      isDense: true,
      labelText: label,
      labelStyle: const TextStyle(color: Colors.white54, fontSize: 12),
      filled: true,
      fillColor: const Color(0xFF0B141A),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
      disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white54)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
    );
    if (controller != null) {
      return TextField(controller: controller, obscureText: obscure, enabled: enabled, style: const TextStyle(color: Colors.white), decoration: base);
    }
    return TextField(controller: TextEditingController(text: value ?? ''), enabled: false, style: const TextStyle(color: Colors.white70), decoration: base);
  }
}
