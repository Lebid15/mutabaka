import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api_client.dart';
import '../../services/session.dart';

class SubscriptionsPage extends StatefulWidget {
  const SubscriptionsPage({super.key});
  @override
  State<SubscriptionsPage> createState() => _SubscriptionsPageState();
}

class _SubscriptionsPageState extends State<SubscriptionsPage> {
  final Dio _dio = ApiClient.dio;

  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _sub;
  Map<String, dynamic>? _pending;
  List<Map<String, dynamic>> _plans = [];
  String _selectedPlan = 'silver';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) { setState(() { _loading = false; _error = 'الرجاء تسجيل الدخول أولاً'; }); return; }
    setState(() { _loading = true; _error = null; });
    try {
      final me = await _dio.get('/api/subscriptions/me', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = (me.data as Map).cast<String, dynamic>();
      _sub = (data['subscription'] as Map?)?.cast<String, dynamic>();
      _pending = (data['pending_request'] as Map?)?.cast<String, dynamic>();
      final pl = await _dio.get('/api/subscriptions/plans', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final list = (pl.data as List?)?.map((e) => (e as Map).cast<String, dynamic>()).toList() ?? <Map<String,dynamic>>[];
      _plans = list;
      final code = (_sub?['plan'] as Map?)?['code']?.toString();
      if (code != null && code.isNotEmpty) _selectedPlan = code;
      setState(() {});
    } catch (e) {
      setState(() { _error = 'تعذر تحميل البيانات'; });
    } finally { setState(() { _loading = false; }); }
  }

  String _planLabel(String? code) {
    final c = (code ?? '').toLowerCase();
    if (c == 'silver') return 'فضي';
    if (c == 'golden') return 'ذهبي';
    if (c == 'king') return 'ملكي';
    return code ?? '—';
  }

  String _planNameOrLabel(Map<String, dynamic>? plan) {
    final name = (plan?['name'] ?? '').toString();
    final code = (plan?['code'] ?? '').toString();
    return name.trim().isNotEmpty ? name : _planLabel(code);
  }

  String _statusLabel(String? s) {
    if (s == null || s.isEmpty) return 'غير معروف';
    if (s == 'active') return 'نشط';
    if (s == 'expired') return 'منتهي';
    if (s == 'cancelled') return 'ملغي';
    return s;
  }

  String _formatDateEn(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    try {
      final d = DateTime.parse(iso).toLocal();
      final two = (int n) => n.toString().padLeft(2, '0');
      return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}:${two(d.minute)}';
    } catch (_) { return iso; }
  }

  int _remainingDays() {
    final end = (_sub?['end_at'] ?? '').toString();
    if (end.isEmpty) return 0;
    try {
      final e = DateTime.parse(end);
      final now = DateTime.now();
      final diff = e.difference(now).inDays;
      return diff < 0 ? 0 : diff;
    } catch (_) { return 0; }
  }

  List<Map<String, dynamic>> get _sortedPlans {
    final order = {'silver':0, 'golden':1, 'king':2};
    final copy = [..._plans];
    copy.sort((a,b) => (order[(a['code']??'').toString().toLowerCase()] ?? 999)
        .compareTo(order[(b['code']??'').toString().toLowerCase()] ?? 999));
    return copy;
  }

  Future<void> _renew(String period) async {
    final token = Session.I.accessToken; if (token == null) return;
    setState(() => _busy = true);
    try {
      await _dio.post('/api/subscriptions/renew',
        data: { 'plan_code': _selectedPlan, 'period': period },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم إنشاء طلب التجديد بنجاح، سيتم مراجعته')));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إنشاء الطلب')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
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
          title: const Text('الاشتراك'),
        ),
        body: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              // Plans snapshot table (top)
              Container(
                decoration: BoxDecoration(
                  color: const Color(0x1AFFFFFF),
                  border: Border.all(color: divider),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    // Row 1 names
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.1),
                        border: Border(bottom: BorderSide(color: divider)),
                      ),
                      child: const Row(
                        children: [
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('فضي', style: TextStyle(fontWeight: FontWeight.w600, color: Colors.white))))),
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('ذهبي', style: TextStyle(fontWeight: FontWeight.w600, color: Colors.white))))),
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('ملكي', style: TextStyle(fontWeight: FontWeight.w600, color: Colors.white))))),
                        ],
                      ),
                    ),
                    // Row 2 contacts
                    Container(
                      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: divider))),
                      child: const Row(
                        children: [
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('5 جهات اتصال', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('30 جهة اتصال', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                          Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('غير محدود', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                        ],
                      ),
                    ),
                    // Row 3 price
                    const Row(
                      children: [
                        Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('20 دولار', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                        Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('30 دولار', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                        Expanded(child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Center(child: Text('50 دولار', style: TextStyle(color: Colors.white70, fontSize: 12))))),
                      ],
                    )
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: _loading
                    ? const Align(alignment: Alignment.topRight, child: Padding(padding: EdgeInsets.all(8), child: Text('جارٍ التحميل…', style: TextStyle(color: Colors.white60))))
                    : (_error != null)
                        ? Align(alignment: Alignment.topRight, child: Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))))
                        : SingleChildScrollView(
                            child: Column(
                              children: [
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF111B21),
                                    border: Border.all(color: divider),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Column(
                                    children: [
                                      if (_pending != null)
                                        Container(
                                          margin: const EdgeInsets.only(bottom: 8),
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                                          decoration: BoxDecoration(
                                            color: const Color(0x33F59E0B),
                                            border: Border.all(color: const Color(0x66F59E0B)),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: const Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              SizedBox(width: 6, height: 6, child: DecoratedBox(decoration: BoxDecoration(color: Color(0xFFFBBF24), shape: BoxShape.circle))),
                                              SizedBox(width: 6),
                                              Text('طلبك قيد المراجعة', style: TextStyle(color: Color(0xFFFDE68A), fontSize: 12)),
                                            ],
                                          ),
                                        ),
                                      _kv('الباقة الحالية', _planNameOrLabel((_sub?['plan'] as Map?)?.cast<String, dynamic>())),
                                      _kv('نوع الاشتراك', _inferPeriodLabel(_sub?['start_at']?.toString(), _sub?['end_at']?.toString())),
                                      _kv('تاريخ آخر اشتراك', _formatDateEn(_sub?['start_at']?.toString())),
                                      _kv('تاريخ الانتهاء', _formatDateEn(_sub?['end_at']?.toString())),
                                      _kv('الحالة', _statusLabel(_sub?['status']?.toString())),
                                      _kv('الأيام المتبقية', _remainingDays().toString()),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 10),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF111B21),
                                    border: Border.all(color: divider),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('ترقية الباقة', style: TextStyle(color: Colors.white, fontSize: 13)),
                                      const SizedBox(height: 8),
                                      DropdownButtonFormField<String>(
                                        value: _selectedPlan,
                                        items: _sortedPlans.map((p) => DropdownMenuItem(
                                          value: (p['code'] ?? '').toString(),
                                          child: Text(_planNameOrLabel(p), style: const TextStyle(color: Colors.white)),
                                        )).toList(),
                                        onChanged: (_pending != null || _busy) ? null : (v) { if (v != null) setState(() => _selectedPlan = v); },
                                        dropdownColor: const Color(0xFF111B21),
                                      ),
                                      const SizedBox(height: 10),
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          IntrinsicWidth(child: FilledButton(
                                            onPressed: (_pending != null || _busy) ? null : () => _renew('monthly'),
                                            child: const Text('تجديد شهري'),
                                          )),
                                          const SizedBox(width: 8),
                                          IntrinsicWidth(child: FilledButton(
                                            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
                                            onPressed: (_pending != null || _busy) ? null : () => _renew('yearly'),
                                            child: Row(children: [
                                              const Text('تجديد سنوي'),
                                              const SizedBox(width: 6),
                                              if (_selectedPlanDiscount != null) Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(color: const Color(0xFFFDE68A), borderRadius: BorderRadius.circular(999)),
                                                child: Text('خصم ${_selectedPlanDiscount} %', style: const TextStyle(color: Color(0xFF713F12), fontSize: 10, fontWeight: FontWeight.bold)),
                                              ),
                                            ]),
                                          )),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic>? get _selectedPlanInfo => _plans.firstWhere(
    (p) => (p['code'] ?? '').toString().toLowerCase() == _selectedPlan.toLowerCase(),
    orElse: () => <String, dynamic>{},
  );

  int? get _selectedPlanDiscount {
    final info = _selectedPlanInfo;
    if (info == null || info.isEmpty) return null;
    final raw = info['yearly_discount_percent'];
    if (raw == null) return null;
    try {
      final n = (raw is num) ? raw.toInt() : int.parse(raw.toString());
      return n > 0 ? n : null;
    } catch (_) {
      return null;
    }
  }

  String _inferPeriodLabel(String? startIso, String? endIso) {
    if (startIso == null || endIso == null) return '—';
    try {
      final start = DateTime.parse(startIso);
      final end = DateTime.parse(endIso);
      final days = end.difference(start).inDays;
      return days >= 200 ? 'سنوي' : 'شهري';
    } catch (_) { return '—'; }
  }

  Widget _kv(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(k, style: const TextStyle(color: Colors.white60, fontSize: 12)),
          Text(v, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
