import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'home_controller.dart';

class ChatPage extends StatefulWidget {
  final HomeController controller;
  final int conversationId;
  const ChatPage({super.key, required this.controller, required this.conversationId});

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  // Controllers/state
  final ScrollController _listCtrl = ScrollController();
  final _inputCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  final _searchFocus = FocusNode();
  bool _showSearch = false;

  final GlobalKey _membersIconKey = GlobalKey();
  final GlobalKey _currencyKey = GlobalKey();

  final TextEditingController _amtLkmCtrl = TextEditingController();
  final TextEditingController _amtLnaCtrl = TextEditingController();
  final TextInputFormatter _amountFormatter = _AmountFormatter();
  int? _selectedCurrencyId;

  // Search navigation
  final Map<String, GlobalKey> _msgKeys = {};
  GlobalKey _keyForMsg(String id) => _msgKeys.putIfAbsent(id, () => GlobalKey());
  List<_MatchPos> _matches = [];
  int _currentMatch = 0;

  VoidCallback? _controllerListener;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      widget.controller.fetchMessages(widget.conversationId);
      widget.controller.refreshConvAggregates(widget.conversationId);
      await widget.controller.ensureCurrenciesLoaded();
      await _autoSelectDefaultCurrency();
      if (!mounted) return;
      setState(() {
        _selectedCurrencyId = widget.controller.selectedCurrencyByConv[widget.conversationId];
      });
    });
    _controllerListener = () {
      if (_showSearch && _searchCtrl.text.trim().isNotEmpty) _recomputeMatches();
    };
    widget.controller.addListener(_controllerListener!);
  }

  @override
  void dispose() {
    _listCtrl.dispose();
    _inputCtrl.dispose();
    _searchCtrl.dispose();
    _searchFocus.dispose();
    _amtLkmCtrl.dispose();
    _amtLnaCtrl.dispose();
    if (_controllerListener != null) widget.controller.removeListener(_controllerListener!);
    super.dispose();
  }

  // Currency
  Future<int?> _autoSelectDefaultCurrency() async {
    await widget.controller.ensureCurrenciesLoaded();
    final convId = widget.conversationId;
    var selected = widget.controller.selectedCurrencyByConv[convId];
    if (selected != null) return selected;
    final list = widget.controller.currencies;
    if (list.isEmpty) return null;
    try {
      selected = list.firstWhere((c) => (c['code'] ?? '').toString().toUpperCase() == 'USD')['id'] as int;
    } catch (_) {
      selected = list.first['id'] as int;
    }
    widget.controller.selectCurrencyFor(convId, selected);
    if (mounted) setState(() => _selectedCurrencyId = selected);
    return selected;
  }

  // Search
  void _toggleSearch() {
    setState(() => _showSearch = !_showSearch);
    if (_showSearch) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _searchFocus.requestFocus());
    } else {
      _searchCtrl.clear();
      setState(() {
        _matches = [];
        _currentMatch = 0;
      });
    }
  }

  void _recomputeMatches() {
    final q = _searchCtrl.text.trim();
    if (q.isEmpty) {
      setState(() {
        _matches = [];
        _currentMatch = 0;
      });
      return;
    }
    final lowerQ = q.toLowerCase();
    final messages = widget.controller.getMessagesFor(widget.conversationId);
    final list = <_MatchPos>[];
    for (var i = 0; i < messages.length; i++) {
      final m = messages[i];
      final t = m.text;
      if (t == null || t.isEmpty) continue;
      final lowerT = t.toLowerCase();
      var start = 0;
      while (true) {
        final idx = lowerT.indexOf(lowerQ, start);
        if (idx == -1) break;
        list.add(_MatchPos(messageIndex: i, messageId: m.id, start: idx, end: idx + lowerQ.length));
        start = idx + lowerQ.length;
      }
    }
    setState(() {
      _matches = list;
      if (_matches.isEmpty) {
        _currentMatch = 0;
      } else if (_currentMatch >= _matches.length) {
        _currentMatch = _matches.length - 1;
      }
    });
  }

  void _gotoMatch(int newIndex) {
    if (_matches.isEmpty) return;
    setState(() {
      if (newIndex < 0) {
        _currentMatch = _matches.length - 1;
      } else if (newIndex >= _matches.length) {
        _currentMatch = 0;
      } else {
        _currentMatch = newIndex;
      }
    });
    final mp = _matches[_currentMatch];
    final key = _keyForMsg(mp.messageId);
    final ctx = key.currentContext;
    if (ctx != null) Scrollable.ensureVisible(ctx, alignment: 0.3, duration: const Duration(milliseconds: 250));
  }

  // Transactions
  void _onAmountChanged(bool isLna, String _) {
    if (isLna) {
      if (_amtLnaCtrl.text.isNotEmpty && _amtLkmCtrl.text.isNotEmpty) _amtLkmCtrl.clear();
    } else {
      if (_amtLkmCtrl.text.isNotEmpty && _amtLnaCtrl.text.isNotEmpty) _amtLnaCtrl.clear();
    }
    setState(() {});
  }

  Future<void> _sendTransaction() async {
    final lna = _amtLnaCtrl.text.trim();
    final lkm = _amtLkmCtrl.text.trim();
    String? direction;
    String amount = '';
    if (lna.isNotEmpty && lkm.isNotEmpty) _amtLkmCtrl.clear();
    if (_amtLnaCtrl.text.trim().isNotEmpty) {
      direction = 'lna';
      amount = _amtLnaCtrl.text.trim();
    } else if (_amtLkmCtrl.text.trim().isNotEmpty) {
      direction = 'lkm';
      amount = _amtLkmCtrl.text.trim();
    }
    if (direction == null || amount.isEmpty) {
      _showTopBanner('أدخل المبلغ واختر الاتجاه');
      return;
    }
    final effectiveCur = _selectedCurrencyId ?? widget.controller.selectedCurrencyByConv[widget.conversationId] ?? await _autoSelectDefaultCurrency();
    if (effectiveCur == null) {
      _showTopBanner('اختر العملة أولاً');
      return;
    }
    final note = widget.controller.getTempNote(widget.conversationId);
    final result = await widget.controller.createTransaction(
      conversationId: widget.conversationId,
      direction: direction,
      amount: amount,
      note: note,
    );
    if (!mounted) return;
    if (!result.ok) {
      _showTopBanner(result.error ?? 'فشل إرسال المعاملة');
    } else {
      _amtLnaCtrl.clear();
      _amtLkmCtrl.clear();
      widget.controller.clearTempNote(widget.conversationId);
      setState(() {});
      if (_showSearch && _searchCtrl.text.trim().isNotEmpty) _recomputeMatches();
    }
  }

  // UI
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final conv = widget.controller.getConversation(widget.conversationId);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        backgroundColor: const Color(0xFF0B141A),
        appBar: AppBar(
          backgroundColor: const Color(0xFF111B21),
          elevation: 0,
          scrolledUnderElevation: 0,
          shadowColor: Colors.transparent,
          surfaceTintColor: Colors.transparent,
          iconTheme: IconThemeData(color: scheme.onSurface),
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  conv?.title ?? 'محادثة',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: scheme.onSurface),
                ),
              ),
              const SizedBox(width: 12),
              IconButton(
                key: _membersIconKey,
                tooltip: 'الأعضاء',
                icon: const Icon(Icons.group_outlined, size: 18, color: Colors.white70),
                onPressed: () async {
                  final box = _membersIconKey.currentContext?.findRenderObject() as RenderBox?;
                  final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
                  final position = (box != null)
                      ? RelativeRect.fromRect(
                          Rect.fromPoints(
                            box.localToGlobal(Offset.zero, ancestor: overlay),
                            box.localToGlobal(box.size.bottomRight(Offset.zero), ancestor: overlay),
                          ),
                          Offset.zero & overlay.size,
                        )
                      : const RelativeRect.fromLTRB(0, 56, 0, 0);
                  final members = await widget.controller.getConversationMembers(widget.conversationId);
                  // Menu with members
                  // ignore: use_build_context_synchronously
                  await showMenu<void>(
                    context: context,
                    position: position,
                    items: [
                      PopupMenuItem(
                        enabled: false,
                        padding: EdgeInsets.zero,
                        child: Directionality(
                          textDirection: TextDirection.rtl,
                          child: Container(
                            width: 320,
                            constraints: const BoxConstraints(maxHeight: 360),
                            color: const Color(0xFF111B21),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Padding(
                                  padding: EdgeInsets.fromLTRB(12, 10, 12, 6),
                                  child: Text('أعضاء المحادثة', style: TextStyle(color: Colors.white70, fontSize: 12)),
                                ),
                                const Divider(height: 1, color: Colors.white12),
                                Flexible(
                                  child: ListView.separated(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    shrinkWrap: true,
                                    itemCount: members.length,
                                    separatorBuilder: (_, __) => const Divider(color: Colors.white12, height: 1),
                                    itemBuilder: (_, i) {
                                      final m = members[i];
                                      final name = (m['display_name'] ?? m['username'] ?? '').toString();
                                      final role = (m['role'] ?? '').toString();
                                      return ListTile(
                                        dense: true,
                                        leading: const CircleAvatar(radius: 14, backgroundColor: Color(0xFF1F2C34), child: Icon(Icons.person, color: Colors.white70, size: 16)),
                                        title: Text(name, style: const TextStyle(color: Colors.white)),
                                        subtitle: Text(
                                          role == 'participant' ? 'مشارك' : role == 'team_member' ? 'عضو فريق' : 'عضو إضافي',
                                          style: const TextStyle(color: Colors.white54, fontSize: 12),
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
                    ],
                  );
                },
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'بحث',
                icon: const Icon(Icons.search, size: 18, color: Colors.white70),
                onPressed: _toggleSearch,
              ),
            ],
          ),
        ),
        body: Column(
          children: [
            // Summary row (hide zeros)
            AnimatedBuilder(
              animation: widget.controller,
              builder: (context, _) {
                final map = widget.controller.pairWalletByConv[widget.conversationId] ?? const {};
                final syms = widget.controller.pairSymbolsByConv[widget.conversationId] ?? const {};
                final entries = map.entries.where((e) => (e.value).abs() > 0.00001).toList()..sort((a, b) => a.key.compareTo(b.key));
                return Container(
                  height: 40,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  alignment: Alignment.centerRight,
                  decoration: const BoxDecoration(color: Color(0xFF111B21)),
                  child: Row(
                    children: [
                      Expanded(
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          reverse: true,
                          child: Row(
                            textDirection: TextDirection.rtl,
                            children: [
                              if (entries.isEmpty)
                                const Text('لا ملخص بعد', style: TextStyle(color: Colors.white60, fontSize: 12))
                              else
                                for (final e in entries) ...[
                                  Text('${e.value.toStringAsFixed(2)} ${syms[e.key] ?? e.key}', style: const TextStyle(color: Color(0xFF16A34A), fontSize: 13, fontWeight: FontWeight.w600)),
                                  const SizedBox(width: 20),
                                ]
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
            // Inline search bar
            AnimatedCrossFade(
              firstChild: const SizedBox.shrink(),
              secondChild: Container(
                color: const Color(0xFF111B21),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        focusNode: _searchFocus,
                        onChanged: (_) => _recomputeMatches(),
                        style: const TextStyle(color: Colors.white),
                        decoration: const InputDecoration(
                          isDense: true,
                          hintText: 'ابحث داخل الدردشة…',
                          hintStyle: TextStyle(color: Colors.white60),
                          filled: true,
                          fillColor: Color(0xFF1F2C34),
                          border: OutlineInputBorder(borderSide: BorderSide.none, borderRadius: BorderRadius.all(Radius.circular(8))),
                          contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(_matches.isEmpty ? '0/0' : '${_currentMatch + 1}/${_matches.length}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    IconButton(
                      tooltip: 'السابق',
                      onPressed: _matches.isEmpty ? null : () => _gotoMatch(_currentMatch - 1),
                      icon: const Icon(Icons.keyboard_arrow_up, color: Colors.white70),
                    ),
                    IconButton(
                      tooltip: 'التالي',
                      onPressed: _matches.isEmpty ? null : () => _gotoMatch(_currentMatch + 1),
                      icon: const Icon(Icons.keyboard_arrow_down, color: Colors.white70),
                    ),
                    IconButton(
                      tooltip: 'إغلاق البحث',
                      onPressed: _toggleSearch,
                      icon: const Icon(Icons.close, color: Colors.white70),
                    ),
                  ],
                ),
              ),
              crossFadeState: _showSearch ? CrossFadeState.showSecond : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 180),
            ),
            // Messages
            Expanded(
              child: AnimatedBuilder(
                animation: widget.controller,
                builder: (context, _) {
                  final messages = widget.controller.getMessagesFor(widget.conversationId);
                  if (messages.isEmpty) {
                    return Container(color: const Color(0xFF0B141A), alignment: Alignment.center, child: const Text('لا رسائل بعد — اكتب رسالة…', style: TextStyle(color: Colors.white70)));
                  }
                  return Container(
                    color: const Color(0xFF0B141A),
                    child: ListView.builder(
                      reverse: true,
                      controller: _listCtrl,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      itemCount: messages.length,
                      itemBuilder: (context, idx) {
                        final msg = messages[messages.length - 1 - idx];
                        final isMine = msg.sender == Sender.me;
                        final key = _keyForMsg(msg.id);

                        Widget senderRow() {
                          final name = msg.senderDisplay ?? '';
                          if (name.isEmpty) return const SizedBox.shrink();
                          return Row(
                            // Align name on the same side as the bubble (RTL aware)
                            mainAxisAlignment: isMine ? MainAxisAlignment.start : MainAxisAlignment.end,
                            children: [
                              Padding(
                                padding: const EdgeInsetsDirectional.only(start: 8, end: 8, bottom: 2),
                                child: Text(name, style: const TextStyle(color: Colors.white70, fontSize: 11)),
                              ),
                            ],
                          );
                        }
                        // Treat transaction-like one-line texts as proper 3-line transaction bubbles
                        final _ParsedTx? parsedTx = msg.text != null ? _parseTxFromText(msg.text!) : null;
                        final bool isTransaction = (msg.text == null) || (parsedTx != null);

                        if (!isTransaction && msg.text != null) {
                          return KeyedSubtree(
                            key: key,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Column(
                                children: [
                                  senderRow(),
                                  Directionality(
                                    textDirection: TextDirection.ltr,
                                    child: Row(
                                      mainAxisAlignment: isMine ? MainAxisAlignment.end : MainAxisAlignment.start,
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        IntrinsicWidth(
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            decoration: BoxDecoration(
                                              color: isMine ? const Color(0xFF005C4B) : const Color(0xFF202C33),
                                              borderRadius: BorderRadius.only(
                                                topLeft: const Radius.circular(16),
                                                topRight: const Radius.circular(16),
                                                bottomLeft: isMine ? const Radius.circular(4) : const Radius.circular(16),
                                                bottomRight: isMine ? const Radius.circular(16) : const Radius.circular(4),
                                              ),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                _buildMessageTextWithHighlights(msg),
                                                const SizedBox(height: 4),
                                                Align(
                                                  alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                                                  widthFactor: 1,
                                                  child: Text(_formatTime(msg.createdAt), textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white54, fontSize: 10)),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        } else {
                          // Transaction message
                          final dir = parsedTx?.direction ?? msg.txDirection;
                          final sign = dir == 'lna' ? '+' : '-';
                          return KeyedSubtree(
                            key: key,
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Column(
                                children: [
                                  senderRow(),
                                  Directionality(
                                    textDirection: TextDirection.ltr,
                                    child: Row(
                                      mainAxisAlignment: isMine ? MainAxisAlignment.end : MainAxisAlignment.start,
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        IntrinsicWidth(
                                          child: Container(
                                            constraints: const BoxConstraints(maxWidth: 500),
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            decoration: BoxDecoration(
                                              color: isMine ? const Color(0xFF005C4B) : const Color(0xFF202C33),
                                              borderRadius: BorderRadius.only(
                                                topLeft: const Radius.circular(16),
                                                topRight: const Radius.circular(16),
                                                bottomLeft: isMine ? const Radius.circular(4) : const Radius.circular(16),
                                                bottomRight: isMine ? const Radius.circular(16) : const Radius.circular(4),
                                              ),
                                            ),
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                // Line 1: label + pill
                                                Directionality(
                                                  textDirection: TextDirection.rtl,
                                                  child: Row(
                                                    mainAxisSize: MainAxisSize.min,
                                                    children: [
                                                      const Text('معاملة', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
                                                      const SizedBox(width: 8),
                                                      Container(
                                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                        decoration: BoxDecoration(
                                                          color: dir == 'lna' ? const Color(0xFF145C49) : const Color(0xFF7A1D1D),
                                                          borderRadius: BorderRadius.circular(999),
                                                        ),
                                                        child: Text(dir == 'lna' ? 'لنا' : 'لكم', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700)),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                const SizedBox(height: 4),
                                                // Line 2: amount (LTR)
                                                Directionality(
                                                  textDirection: TextDirection.ltr,
                                                  child: Text(
                                                    () {
                                                      final amount = parsedTx?.amount ?? msg.txAmount;
                                                      final sym = parsedTx?.symbol ?? msg.txSymbol ?? '';
                                                      final amtStr = (amount != null) ? amount.toStringAsFixed(2) : '';
                                                      return '$sign $amtStr $sym';
                                                    }(),
                                                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12),
                                                  ),
                                                ),
                                                // Line 3: note (optional, RTL)
                                                if ((parsedTx?.note != null && parsedTx!.note!.isNotEmpty) || (msg.txNote != null && msg.txNote!.isNotEmpty)) ...[
                                                  const SizedBox(height: 3),
                                                  Directionality(
                                                    textDirection: TextDirection.rtl,
                                                    child: Text(parsedTx?.note ?? msg.txNote!, style: const TextStyle(color: Colors.white70, fontSize: 10)),
                                                  ),
                                                ],
                                                const SizedBox(height: 4),
                                                Align(
                                                  alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                                                  widthFactor: 1,
                                                  child: Text(_formatTime(msg.createdAt), textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white54, fontSize: 10)),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        bottomNavigationBar: _buildComposer(),
      ),
    );
  }

  Widget _buildComposer() {
    Color chipBg([bool selected = false]) => selected ? const Color(0xFF1F2C34) : const Color(0xFF111B21);
    return SafeArea(
      top: false,
      child: Container(
        decoration: const BoxDecoration(color: Color(0xFF111B21), border: Border(top: BorderSide(color: Color(0xFF24343B), width: 1))),
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Row 1: currency, لنا, لكم, note, send
            Row(
              textDirection: TextDirection.rtl,
              children: [
                Expanded(
                  flex: 3,
                  child: SizedBox(
                    height: 36,
                    child: OutlinedButton(
                      key: _currencyKey,
                      style: ButtonStyle(
                        backgroundColor: MaterialStatePropertyAll(chipBg()),
                        side: const MaterialStatePropertyAll(BorderSide(color: Colors.white24)),
                        shape: MaterialStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                        alignment: Alignment.centerRight,
                        padding: const MaterialStatePropertyAll(EdgeInsets.symmetric(horizontal: 10)),
                      ),
                      onPressed: () async {
                        if (widget.controller.currencies.isEmpty) await widget.controller.ensureCurrenciesLoaded();
                        final overlay = Overlay.of(context).context.findRenderObject() as RenderBox;
                        final rb = _currencyKey.currentContext?.findRenderObject() as RenderBox?;
                        final position = (rb != null)
                            ? RelativeRect.fromRect(
                                Rect.fromPoints(
                                  rb.localToGlobal(Offset.zero, ancestor: overlay),
                                  rb.localToGlobal(rb.size.bottomRight(Offset.zero), ancestor: overlay),
                                ),
                                Offset.zero & overlay.size,
                              )
                            : const RelativeRect.fromLTRB(0, 56, 0, 0);
                        final chosen = await showMenu<int>(
                          context: context,
                          position: position,
                          items: [
                            for (final c in widget.controller.currencies)
                              PopupMenuItem<int>(
                                value: (c['id'] as int),
                                child: Directionality(
                                  textDirection: TextDirection.rtl,
                                  child: Text((c['name'] ?? c['code'] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                                ),
                              ),
                          ],
                        );
                        if (chosen != null) {
                          setState(() => _selectedCurrencyId = chosen);
                          widget.controller.selectCurrencyFor(widget.conversationId, chosen);
                        }
                      },
                      child: AnimatedBuilder(
                        animation: widget.controller,
                        builder: (context, _) {
                          final id = _selectedCurrencyId ?? widget.controller.selectedCurrencyByConv[widget.conversationId];
                          int? ensureId = id;
                          if (ensureId == null && widget.controller.currencies.isNotEmpty) {
                            try {
                              ensureId = widget.controller.currencies.firstWhere((c) => (c['code'] ?? '').toString().toUpperCase() == 'USD')['id'] as int;
                            } catch (_) {
                              ensureId = widget.controller.currencies.first['id'] as int;
                            }
                            WidgetsBinding.instance.addPostFrameCallback((_) {
                              widget.controller.selectCurrencyFor(widget.conversationId, ensureId!);
                              if (mounted) setState(() => _selectedCurrencyId = ensureId);
                            });
                          }
                          final cur = (ensureId != null) ? widget.controller.currencyById(ensureId) : null;
                          final label = cur != null ? (cur['name'] ?? cur['code'] ?? '').toString() : '';
                          return Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(child: Text(label, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600))),
                              const Icon(Icons.arrow_drop_down, color: Colors.white70),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: SizedBox(
                    height: 36,
                    child: TextField(
                      controller: _amtLnaCtrl,
                      keyboardType: TextInputType.number,
                      inputFormatters: [_amountFormatter],
                      onChanged: (v) => _onAmountChanged(true, v),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                      decoration: InputDecoration(
                        hintText: 'لنا',
                        hintStyle: const TextStyle(color: Colors.white70),
                        isDense: true,
                        filled: true,
                        fillColor: const Color(0xFF111B21),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white24)),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white24)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white54)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: SizedBox(
                    height: 36,
                    child: TextField(
                      controller: _amtLkmCtrl,
                      keyboardType: TextInputType.number,
                      inputFormatters: [_amountFormatter],
                      onChanged: (v) => _onAmountChanged(false, v),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                      decoration: InputDecoration(
                        hintText: 'لكم',
                        hintStyle: const TextStyle(color: Colors.white70),
                        isDense: true,
                        filled: true,
                        fillColor: const Color(0xFF111B21),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white24)),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white24)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white54)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 36,
                  width: 44,
                  child: OutlinedButton(
                    style: const ButtonStyle(
                      backgroundColor: MaterialStatePropertyAll(Color(0xFF111B21)),
                      side: MaterialStatePropertyAll(BorderSide(color: Colors.white24)),
                      shape: MaterialStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(10)))),
                      padding: MaterialStatePropertyAll(EdgeInsets.zero),
                    ),
                    onPressed: _openNoteDialog,
                    child: const Icon(Icons.receipt_long, color: Colors.white70, size: 18),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 36,
                  width: 44,
                  child: FilledButton(
                    style: const ButtonStyle(
                      backgroundColor: MaterialStatePropertyAll(Color(0xFF1DB954)),
                      shape: MaterialStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(10)))),
                    ),
                    onPressed: _sendTransaction,
                    child: const Icon(Icons.send, size: 18),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Row 2: attachment, input, send
            Row(
              textDirection: TextDirection.rtl,
              children: [
                SizedBox(
                  height: 44,
                  width: 44,
                  child: IconButton(
                    onPressed: () async {
                      final res = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'], withData: false);
                      if (res == null || res.files.isEmpty) return;
                      final f = res.files.first;
                      final path = f.path;
                      if (path == null || path.isEmpty) {
                        _showTopBanner('تعذر قراءة الملف');
                        return;
                      }
                      final caption = _inputCtrl.text.trim().isNotEmpty ? _inputCtrl.text.trim() : null;
                      var outcome = await widget.controller.sendAttachment(widget.conversationId, filePath: path, fileName: f.name, caption: caption);
                      if (!mounted) return;
                      if (!outcome.ok && outcome.otpRequired) {
                        final otp = await _promptOtp();
                        if (otp != null && otp.isNotEmpty) {
                          outcome = await widget.controller.sendAttachment(widget.conversationId, filePath: path, fileName: f.name, caption: caption, otp: otp);
                        }
                      }
                      if (!mounted) return;
                      if (!outcome.ok) {
                        _showTopBanner(outcome.error ?? 'فشل رفع المرفق');
                      } else {
                        _inputCtrl.clear();
                        if (_showSearch && _searchCtrl.text.trim().isNotEmpty) _recomputeMatches();
                      }
                    },
                    icon: const Icon(Icons.attach_file, color: Colors.white70),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _inputCtrl,
                    minLines: 1,
                    maxLines: 4,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'اكتب رسالة',
                      hintStyle: const TextStyle(color: Colors.white60),
                      filled: true,
                      fillColor: const Color(0xFF1A2B32),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white24)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white24)),
                      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white54)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 44,
                  width: 44,
                  child: FilledButton(
                    style: const ButtonStyle(backgroundColor: MaterialStatePropertyAll(Color(0xFF1DB954)), shape: MaterialStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(10))))),
                    onPressed: () async {
                      final text = _inputCtrl.text.trim();
                      if (text.isEmpty) return;
                      final result = await widget.controller.sendMessageApi(widget.conversationId, text);
                      if (!mounted) return;
                      if (!result.ok) {
                        if (result.otpRequired) {
                          final otp = await _promptOtp();
                          if (otp != null && otp.isNotEmpty) {
                            final retry = await widget.controller.sendMessageApi(widget.conversationId, text, otp: otp);
                            if (!retry.ok) {
                              _showTopBanner(retry.error ?? 'فشل الإرسال — تحقق من الاشتراك/الأذونات');
                              return;
                            }
                          } else {
                            return;
                          }
                        } else {
                          _showTopBanner(result.error ?? 'فشل الإرسال — تحقق من الاشتراك/الأذونات');
                          return;
                        }
                      }
                      _inputCtrl.clear();
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        if (_listCtrl.hasClients) {
                          _listCtrl.animateTo(0, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
                        }
                      });
                      if (_showSearch && _searchCtrl.text.trim().isNotEmpty) _recomputeMatches();
                    },
                    child: const Icon(Icons.send, size: 18),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // Dialogs and helpers
  Future<void> _openNoteDialog() async {
    final TextEditingController noteCtrl = TextEditingController(text: widget.controller.getTempNote(widget.conversationId) ?? '');
    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            backgroundColor: const Color(0xFF111B21),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFF24343B))),
            title: const Text('إضافة ملاحظة', style: TextStyle(color: Colors.white)),
            content: SizedBox(
              width: 420,
              child: TextField(
                controller: noteCtrl,
                minLines: 3,
                maxLines: 6,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'اكتب ملاحظتك هنا',
                  hintStyle: const TextStyle(color: Colors.white60),
                  filled: true,
                  fillColor: const Color(0xFF1F2C34),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white54)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
            ),
            actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('إلغاء', style: TextStyle(color: Colors.white70))),
              FilledButton(
                style: const ButtonStyle(backgroundColor: MaterialStatePropertyAll(Color(0xFF1DB954))),
                onPressed: () {
                  widget.controller.setTempNote(widget.conversationId, noteCtrl.text);
                  Navigator.of(ctx).pop();
                  _showTopBanner('تم الحفظ مؤقتًا');
                },
                child: const Text('حفظ مؤقتًا'),
              ),
            ],
          ),
        );
      },
    );
  }

  void _showTopBanner(String message) {
    if (!mounted) return;
    final sm = ScaffoldMessenger.of(context);
    sm.hideCurrentSnackBar();
    sm.removeCurrentMaterialBanner();
    final banner = MaterialBanner(
      backgroundColor: const Color(0xFF1F2C34),
      elevation: 0,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      leading: const Icon(Icons.info_outline, color: Colors.white70, size: 18),
      content: Directionality(textDirection: TextDirection.rtl, child: Text(message, style: const TextStyle(color: Colors.white))),
      actions: [TextButton(onPressed: () => sm.removeCurrentMaterialBanner(), child: const Text('إخفاء', style: TextStyle(color: Colors.white70)))],
    );
    sm.showMaterialBanner(banner);
    Future.delayed(const Duration(seconds: 2), () {
      if (!mounted) return;
      sm.removeCurrentMaterialBanner();
    });
  }

  String _formatTime(DateTime dt) {
    var hour = dt.hour;
    final minute = dt.minute.toString().padLeft(2, '0');
    final ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour == 0) hour = 12;
    return '${hour.toString().padLeft(2, '0')}:$minute $ampm';
  }

  InlineSpan _buildHighlightedSpan(String text, List<_Range> ranges, _Range? emphasize) {
    final merged = <_Range>[];
    ranges.sort((a, b) => a.start.compareTo(b.start));
    for (final r in ranges) {
      if (merged.isEmpty || r.start > merged.last.end) {
        merged.add(_Range(r.start, r.end));
      } else {
        merged.last.end = merged.last.end >= r.end ? merged.last.end : r.end;
      }
    }
    final spans = <TextSpan>[];
    int cursor = 0;
    for (final r in merged) {
      if (cursor < r.start) spans.add(TextSpan(text: text.substring(cursor, r.start)));
      final sel = (emphasize != null && r.start == emphasize.start && r.end == emphasize.end);
      spans.add(TextSpan(text: text.substring(r.start, r.end), style: TextStyle(backgroundColor: sel ? const Color(0x66F59E0B) : const Color(0x33F59E0B))));
      cursor = r.end;
    }
    if (cursor < text.length) spans.add(TextSpan(text: text.substring(cursor)));
    return TextSpan(children: spans, style: const TextStyle(color: Colors.white, fontSize: 13));
  }

  Widget _buildMessageTextWithHighlights(Message msg) {
    final text = msg.text ?? '';
    if (!_showSearch || _searchCtrl.text.trim().isEmpty) {
      return Text(text, style: const TextStyle(color: Colors.white, fontSize: 13));
    }
    final q = _searchCtrl.text.trim();
    final lowerQ = q.toLowerCase();
    final lowerT = text.toLowerCase();
    final ranges = <_Range>[];
    var start = 0;
    while (true) {
      final idx = lowerT.indexOf(lowerQ, start);
      if (idx == -1) break;
      ranges.add(_Range(idx, idx + lowerQ.length));
      start = idx + lowerQ.length;
    }
    if (ranges.isEmpty) return Text(text, style: const TextStyle(color: Colors.white, fontSize: 13));
    _Range? emphasize;
    if (_matches.isNotEmpty) {
      final cur = _matches[_currentMatch];
      if (cur.messageId == msg.id) emphasize = _Range(cur.start, cur.end);
    }
    final span = _buildHighlightedSpan(text, ranges, emphasize);
    return RichText(text: span, textDirection: TextDirection.rtl);
  }

  Future<String?> _promptOtp() async {
    final ctrl = TextEditingController();
    String? code;
    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: AlertDialog(
            backgroundColor: const Color(0xFF111B21),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFF24343B))),
            title: const Text('أدخل رمز التحقق OTP', style: TextStyle(color: Colors.white)),
            content: TextField(
              controller: ctrl,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: '123456',
                hintStyle: const TextStyle(color: Colors.white60),
                filled: true,
                fillColor: const Color(0xFF1F2C34),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white24)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Colors.white54)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
            actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('إلغاء', style: TextStyle(color: Colors.white70))),
              FilledButton(
                style: const ButtonStyle(backgroundColor: MaterialStatePropertyAll(Color(0xFF1DB954))),
                onPressed: () {
                  code = ctrl.text.trim();
                  Navigator.of(ctx).pop();
                },
                child: const Text('تأكيد'),
              ),
            ],
          ),
        );
      },
    );
    return code;
  }
}

class _ParsedTx {
  final String direction; // 'lna' or 'lkm'
  final double? amount;
  final String? symbol; // e.g., $
  final String? note;
  _ParsedTx({required this.direction, this.amount, this.symbol, this.note});
}

_ParsedTx? _parseTxFromText(String text) {
  // Heuristics for messages like: "1.00 معاملة: لنا $ - from ali ali" or "$ 100.00 معاملة: لنا - from ahmad"
  // Normalize spaces
  final t = text.trim();
  if (t.isEmpty) return null;
  // Must include the word معاملة
  if (!t.contains('معاملة')) return null;

  // Direction
  String? direction;
  if (t.contains('لنا')) direction = 'lna';
  if (t.contains('لكم')) direction = 'lkm';
  if (direction == null) return null;

  // Amount and symbol: try to find currency symbol ($) and a number nearby (LTR order often appears)
  final symbolMatch = RegExp(r'[€$£]|USD|EUR|SAR|AED|EGP').firstMatch(t);
  String? symbol = symbolMatch?.group(0);

  // Find first number (integer/decimal)
  final numMatch = RegExp(r'(\d+[\.,]?\d*)').firstMatch(t);
  double? amount;
  if (numMatch != null) {
    final raw = numMatch.group(1)!.replaceAll(',', '.');
    amount = double.tryParse(raw);
  }

  // Note: prefer text after an explicit dash separator " - " preserving any words like 'from ...'
  String? note;
  final dashSep = RegExp(r"\s[-–—]\s");
  final dashMatch = dashSep.firstMatch(t);
  if (dashMatch != null && dashMatch.end < t.length) {
    note = t.substring(dashMatch.end).trim();
  } else {
    // Fallback: if 'from' appears and there is no dash, keep it as part of the note
    final fromIdx = t.toLowerCase().indexOf('from');
    if (fromIdx >= 0 && fromIdx < t.length) {
      note = t.substring(fromIdx).trim();
    }
  }

  return _ParsedTx(direction: direction, amount: amount, symbol: symbol, note: note);
}

// Small helpers
class _Range {
  int start;
  int end;
  _Range(this.start, this.end);
}

class _MatchPos extends _Range {
  final int messageIndex;
  final String messageId;
  _MatchPos({required this.messageIndex, required this.messageId, required int start, required int end}) : super(start, end);
}

class _AmountFormatter extends TextInputFormatter {
  final RegExp _re = RegExp(r'^\d{0,13}([\.,]\d{0,5})?$');
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final t = newValue.text;
    if (t.isEmpty) return newValue;
    if (_re.hasMatch(t)) return newValue;
    return oldValue;
  }
}
