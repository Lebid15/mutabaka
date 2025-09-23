import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api_client.dart';
import '../../services/session.dart';

class MatchesPage extends StatefulWidget {
  const MatchesPage({super.key});

  @override
  State<MatchesPage> createState() => _MatchesPageState();
}

class _MatchesPageState extends State<MatchesPage> {
  final Dio _dio = ApiClient.dio;
  bool _loading = true;
  String? _error;
  List<_Row> _rows = [];
  Map<String, dynamic>? _profile;

  // Dynamic widths (computed from content)
  double? _wName, _wUSD, _wTRY, _wSYP, _wEUR;
  final ScrollController _hCtrl = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _hCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final meResp = await _dio.get(
        '/api/auth/me/',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final me = (meResp.data as Map).cast<String, dynamic>();
      _profile = me;

      final convResp = await _dio.get(
        '/api/conversations/',
        queryParameters: {'limit': 200},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final raw = convResp.data;
      final List data = raw is List ? raw : ((raw is Map) ? (raw['results'] as List? ?? const []) : const []);

      final acc = <int, _Row>{};
      for (final e in data) {
        final m = (e as Map);
        final id = m['id'] as int;
        final ua = (m['user_a'] as Map?) ?? {};
        final ub = (m['user_b'] as Map?) ?? {};
        final meId = me['id'] as int?;
        final amA = (meId != null && meId == (ua['id']));
        final other = amA ? ub : ua;
        if (other.isEmpty) continue;
        final otherUsername = (other['username'] ?? '').toString();
        final otherName = (other['display_name'] ?? otherUsername).toString();
        if (_isAdminLike(otherUsername) || _isAdminLike(otherName)) continue;
        final otherAvatar = (other['logo_url'] ?? '').toString();

        try {
          final nb = await _dio.get(
            '/api/conversations/$id/net_balance/',
            options: Options(headers: {'Authorization': 'Bearer $token'}),
          );
          final nets = (nb.data as Map)['net'] as List? ?? const [];
          var row = acc[id];
          row ??= acc[id] = _Row(name: otherName, avatar: otherAvatar);
          for (final r in nets) {
            final mm = (r as Map);
            final code = (mm['currency'] as Map?)?['code']?.toString();
            final rawVal = mm['net_from_user_a_perspective'];
            final numVal = rawVal is num ? rawVal.toDouble() : double.tryParse(rawVal?.toString() ?? '0') ?? 0;
            final val = amA ? numVal : -numVal; // current user's perspective
            if (code == 'USD') row.usd += val;
            else if (code == 'TRY') row.tryy += val;
            else if (code == 'SYP') row.syp += val;
            else if (code == 'EUR') row.eur += val;
          }
        } catch (_) {}
      }

      final rows = acc.values.toList();
      setState(() {
        _rows = rows;
        _recalcColumnWidths();
      });
    } catch (e) {
      setState(() => _error = 'فشل التحميل');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  _Row _totals() {
    return _rows.fold<_Row>(
      _Row.empty(),
      (acc, r) {
        acc.usd += r.usd;
        acc.tryy += r.tryy;
        acc.syp += r.syp;
        acc.eur += r.eur;
        return acc;
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final divider = const Color(0xFF24343B);
    final hdr = Container(
      decoration: const BoxDecoration(
        color: Color(0xFF111B21),
        border: Border(bottom: BorderSide(color: Color(0xFF24343B))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white70, size: 18),
            tooltip: 'رجوع',
          ),
          const SizedBox(width: 6),
          const Text('مطابقاتي', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          const Spacer(),
          Text(( _profile?['display_name'] ?? _profile?['username'] ?? '').toString(),
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ],
      ),
    );

    final totals = _totals();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B141A),
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: SafeArea(bottom: false, child: hdr),
        ),
        body: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              // Two rows: 2 cards each
              Row(children: [
                Expanded(child: _TotalCard(title: 'دولار', value: totals.usd, suffix: '\$')),
                const SizedBox(width: 8),
                Expanded(child: _TotalCard(title: 'تركي', value: totals.tryy, suffix: '₺')),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: _TotalCard(title: 'سوري', value: totals.syp, suffix: 'sp')),
                const SizedBox(width: 8),
                Expanded(child: _TotalCard(title: 'يورو', value: totals.eur, suffix: '€')),
              ]),
              const SizedBox(height: 12),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final nameW = _wName ?? 180;
                    final usdW = _wUSD ?? 100;
                    final tryW = _wTRY ?? 100;
                    final sypW = _wSYP ?? 100;
                    final eurW = _wEUR ?? 100;
                    // Round to an integer pixel width to avoid fractional rounding overflow
                    final contentWidth = (nameW + usdW + tryW + sypW + eurW + 0.5).floorToDouble();
                    final tableWidth = contentWidth > constraints.maxWidth ? contentWidth : constraints.maxWidth;
                    return Scrollbar(
                      controller: _hCtrl,
                      thumbVisibility: true,
                      trackVisibility: false,
                      child: SingleChildScrollView(
                        controller: _hCtrl,
                        scrollDirection: Axis.horizontal,
                        child: SizedBox(
                        width: tableWidth,
                        child: Container(
                          decoration: BoxDecoration(
                            color: const Color(0xFF111B21),
                            border: Border.all(color: divider),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: Column(
                            children: [
                              // Header (use safeRowWidth to avoid overflow rounding)
                              Container(
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                decoration: const BoxDecoration(
                                  color: Color(0xFF111B21),
                                  border: Border(bottom: BorderSide(color: Color(0xFF24343B))),
                                ),
                                child: SizedBox(
                                  width: contentWidth,
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: nameW,
                                        child: const Align(
                                          alignment: Alignment.centerRight,
                                          child: Text('الجهة', style: TextStyle(color: Colors.white70, fontSize: 12)),
                                        ),
                                      ),
                                      _HeadCell('دولار', width: usdW),
                                      _HeadCell('تركي', width: tryW),
                                      _HeadCell('سوري', width: sypW),
                                      _HeadCell('يورو', width: eurW),
                                    ],
                                  ),
                                ),
                              ),
                              if (_loading)
                                const Padding(
                                  padding: EdgeInsets.all(16),
                                  child: Align(
                                    alignment: Alignment.centerRight,
                                    child: Text('جاري التحميل…', style: TextStyle(color: Colors.white60, fontSize: 12)),
                                  ),
                                ),
                              if (_error != null)
                                Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Align(
                                    alignment: Alignment.centerRight,
                                    child: Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12)),
                                  ),
                                ),
                              if (!_loading)
                                Expanded(
                                  child: _rows.isEmpty
                                      ? const Center(child: Text('لا توجد بيانات مطابقة بعد', style: TextStyle(color: Colors.white54)))
                                      : ListView.separated(
                                          padding: EdgeInsets.zero,
                                          itemCount: _rows.length,
                                          separatorBuilder: (_, __) => const Divider(height: 1, color: Color(0x3324343B)),
                                          itemBuilder: (context, idx) {
                                            final r = _rows[idx];
                                            return SizedBox(
                                              width: contentWidth,
                                              child: Padding(
                                                padding: const EdgeInsets.symmetric(vertical: 10),
                                                child: Row(
                                                  children: [
                                                    SizedBox(
                                                      width: nameW,
                                                      child: Row(
                                                        mainAxisAlignment: MainAxisAlignment.end,
                                                        children: [
                                                          CircleAvatar(
                                                            radius: 12,
                                                            backgroundColor: const Color(0xFF1F2C34),
                                                            backgroundImage: (r.avatar.isNotEmpty) ? NetworkImage(r.avatar) : null,
                                                          ),
                                                          const SizedBox(width: 6),
                                                          Flexible(
                                                            child: Align(
                                                              alignment: Alignment.centerRight,
                                                              child: Text(
                                                                r.name,
                                                                overflow: TextOverflow.ellipsis,
                                                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                                                              ),
                                                            ),
                                                          ),
                                                        ],
                                                      ),
                                                    ),
                                                    _ValCell(value: r.usd, suffix: '\$', width: usdW),
                                                    _ValCell(value: r.tryy, suffix: '₺', width: tryW),
                                                    _ValCell(value: r.syp, suffix: 'sp', width: sypW),
                                                    _ValCell(value: r.eur, suffix: '€', width: eurW),
                                                  ],
                                                ),
                                              ),
                                            );
                                          },
                                        ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  bool _isAdminLike(String? u) {
    final n = (u ?? '').toLowerCase();
    return n == 'admin' || n == 'madmin' || n == 'a_admin' || n == 'l_admin';
  }

  // Measuring helpers to compute widths (full cell text, not only longest word)
  String _fmt(double n) {
    final sign = n < 0 ? '-' : '';
    var s = n.abs().toStringAsFixed(5);
    s = s.replaceFirst(RegExp(r'0+$'), '');
    if (s.endsWith('.')) s = s.substring(0, s.length - 1);
    final parts = s.split('.');
    if (parts.length == 1) s = '${parts[0]}.00';
    else if (parts[1].length == 1) s = '${parts[0]}.${parts[1]}0';
    return sign + s;
  }

  double _measureText(String text, TextStyle style) {
    final tp = TextPainter(text: TextSpan(text: text, style: style), textDirection: TextDirection.ltr, maxLines: 1)..layout();
    return tp.width;
  }

  void _recalcColumnWidths() {
    const headerStyle = TextStyle(color: Colors.white70, fontSize: 12);
    const nameStyle = TextStyle(color: Colors.white, fontWeight: FontWeight.w600);
    const valueStyle = TextStyle(color: Colors.white);

    // Name column: measure full name string, plus avatar+spacing (~36px)
    const double extraName = 36;
    double wName = _measureText('الجهة', headerStyle) + extraName;
    for (final r in _rows) {
      final w = _measureText(r.name, nameStyle) + extraName;
      if (w > wName) wName = w;
    }
    if (wName < 140) wName = 140;

    double computeCurr(String header, Iterable<String> values) {
      double w = _measureText(header, headerStyle);
      for (final v in values) {
        final vw = _measureText(v, valueStyle);
        if (vw > w) w = vw;
      }
      if (w < 80) w = 80;
      return w;
    }

    _wName = wName;
  _wUSD = computeCurr('دولار', _rows.map((r) => '${_fmt(r.usd)} \$'));
    _wTRY = computeCurr('تركي', _rows.map((r) => '${_fmt(r.tryy)} ₺'));
    _wSYP = computeCurr('سوري', _rows.map((r) => '${_fmt(r.syp)} sp'));
    _wEUR = computeCurr('يورو', _rows.map((r) => '${_fmt(r.eur)} €'));
  }
}

class _Row {
  String name;
  String avatar;
  double usd = 0;
  double tryy = 0;
  double syp = 0;
  double eur = 0;

  _Row({required this.name, required this.avatar});
  _Row.empty()
      : name = '',
        avatar = '';
}

class _TotalCard extends StatelessWidget {
  final String title;
  final double value;
  final String suffix;
  const _TotalCard({required this.title, required this.value, required this.suffix});

  String _fmt(double n) {
    final sign = n < 0 ? '-' : '';
    var s = n.abs().toStringAsFixed(5);
    s = s.replaceFirst(RegExp(r'0+$'), '');
    if (s.endsWith('.')) s = s.substring(0, s.length - 1);
    final parts = s.split('.');
    if (parts.length == 1) {
      s = '${parts[0]}.00';
    } else if (parts[1].length == 1) {
      s = '${parts[0]}.${parts[1]}0';
    }
    return sign + s;
  }

  @override
  Widget build(BuildContext context) {
    final isNegative = value < 0;
    final color = isNegative ? const Color(0xFFF87171) : Colors.white;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0x1A0D9488),
        border: Border.all(color: const Color(0x3346C2AF)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(color: Colors.white70, fontSize: 11)),
          const SizedBox(height: 4),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Text('${_fmt(value)} $suffix', style: TextStyle(color: color, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _HeadCell extends StatelessWidget {
  final String label;
  final double width;
  const _HeadCell(this.label, {required this.width});
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Text(label, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70, fontSize: 12)),
    );
  }
}

class _ValCell extends StatelessWidget {
  final double value;
  final String suffix;
  final double width;
  const _ValCell({required this.value, required this.suffix, required this.width});

  String _fmt(double n) {
    final sign = n < 0 ? '-' : '';
    var s = n.abs().toStringAsFixed(5);
    s = s.replaceFirst(RegExp(r'0+$'), '');
    if (s.endsWith('.')) s = s.substring(0, s.length - 1);
    final parts = s.split('.');
    if (parts.length == 1) {
      s = '${parts[0]}.00';
    } else if (parts[1].length == 1) {
      s = '${parts[0]}.${parts[1]}0';
    }
    return sign + s;
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: Text('${_fmt(value)} $suffix', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
      ),
    );
  }
}
