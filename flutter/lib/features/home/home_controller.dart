import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import '../../api_client.dart';
import '../../services/session.dart';

enum Sender { me, other }

class Conversation {
  final int id;
  final String title;
  final String otherUsername;
  final String? avatarUrl;
  final String lastPreview;
  final String timeLabel; // e.g., 12:30
  final int unread;
  final bool pinned;
  final bool isMuted;
  Conversation({
    required this.id,
    required this.title,
    required this.otherUsername,
    this.avatarUrl,
    required this.lastPreview,
    required this.timeLabel,
    this.unread = 0,
    this.pinned = false,
    this.isMuted = false,
  });
}

class Contact {
  final int id;
  final String username;
  final String displayName;
  final String? logoUrl;

  Contact({
    required this.id,
    required this.username,
    required this.displayName,
    this.logoUrl,
  });
}

class Message {
  final String id;
  final Sender sender;
  final String? text;
  final DateTime createdAt;
  final String? senderDisplay;
  // Optional: transaction-like bubble
  final String? txDirection; // 'lna' or 'lkm'
  final double? txAmount;
  final String? txSymbol;
  final String? txNote;

  Message.text({
    required this.id,
    required this.sender,
    required this.text,
    required this.createdAt,
    this.senderDisplay,
  })  : txDirection = null,
        txAmount = null,
        txSymbol = null,
        txNote = null;

  Message.tx({
    required this.id,
    required this.sender,
    required this.createdAt,
    this.senderDisplay,
    required this.txDirection,
    required this.txAmount,
    required this.txSymbol,
    this.txNote,
  }) : text = null;
}

class HomeController extends ChangeNotifier {
  // Data
  List<Conversation> conversations = [];
  List<Contact> contacts = [];
  List<Map<String, dynamic>> userSearchResults = [];
  // Currencies (from /api/currencies/)
  List<Map<String, dynamic>> currencies = [];
  // Selected currency per conversation: convId -> currencyId
  final Map<int, int> selectedCurrencyByConv = {};
  // Temporary note per conversation (for transactions)
  final Map<int, String> _tempNoteByConv = {};

  // Aggregates per conversation (pair wallet from current user's perspective)
  // Map: conversationId -> { currencyCode: amount }
  final Map<int, Map<String, double>> pairWalletByConv = {};
  // Currency symbol per code per conversation: conversationId -> { code: symbol }
  final Map<int, Map<String, String>> pairSymbolsByConv = {};

  int? selectedId; // On mobile we don't open any chat by default

  // Each conversation messages
  final Map<int, List<Message>> _messagesByConv = {
  };

  List<Message> get messages => selectedId == null ? const [] : (_messagesByConv[selectedId] ?? const []);

  List<Message> getMessagesFor(int conversationId) => _messagesByConv[conversationId] ?? const [];

  Conversation? getConversation(int conversationId) {
    try {
      return conversations.firstWhere((c) => c.id == conversationId);
    } catch (_) {
      return null;
    }
  }

  void selectConversation(int id) {
    selectedId = id;
    // Mark unread as read in fake model
    final idx = conversations.indexWhere((c) => c.id == id);
    if (idx != -1) {
      final c = conversations[idx];
      conversations[idx] = Conversation(
        id: c.id,
        title: c.title,
        otherUsername: c.otherUsername,
        avatarUrl: c.avatarUrl,
        lastPreview: c.lastPreview,
        timeLabel: c.timeLabel,
        unread: 0,
        pinned: c.pinned,
        isMuted: c.isMuted,
      );
    }
    notifyListeners();
  }

  void sendMessage(String text) {
    final id = selectedId;
    if (id == null || text.trim().isEmpty) return;
    _sendMessageBackend(id, text.trim());
  }

  void sendMessageFor(int conversationId, String text) {
    if (text.trim().isEmpty) return;
    _sendMessageBackend(conversationId, text.trim());
  }

  // ---- Networking ----
  final Dio _dio = ApiClient.dio;
  bool loading = false;
  String? error;

  Future<void> init() async {
    await Future.wait([
      fetchConversations(),
      fetchContacts(),
    ]);
  }

  bool _isAdminLike(String? u) {
    final n = (u ?? '').toLowerCase();
    return n == 'admin' || n == 'madmin' || n == 'a_admin' || n == 'l_admin';
  }

  int? get adminConversationId {
    for (final c in conversations) {
      // We don't store raw participants here, so infer from title; if title looks admin-like show as admin support
      if (_isAdminLike(c.title)) return c.id;
    }
    return null;
  }

  Future<int?> ensureAdminConversation() async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return null;
    try {
      final resp = await _dio.post('/api/ensure_admin_conversation', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final m = (resp.data as Map);
      final cid = int.tryParse('${m['conversation_id'] ?? ''}') ?? adminConversationId;
      await fetchConversations();
      return cid;
    } catch (_) {
      // Fallback: refresh conversations anyway
      await fetchConversations();
      return adminConversationId;
    }
  }

  Future<void> fetchContacts() async {
    try {
      final token = Session.I.accessToken;
      if (token == null || token.isEmpty) return;
      final resp = await _dio.get(
        '/api/contacts/',
        queryParameters: {'limit': 200},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final raw = resp.data;
      final List data = raw is List ? raw : ((raw is Map) ? (raw['results'] as List? ?? const []) : const []);
      contacts = data.map((e) {
        final m = e as Map;
        final contact = (m['contact'] as Map?) ?? {};
        return Contact(
          id: int.tryParse('${contact['id']}') ?? 0,
          username: (contact['username'] ?? '').toString(),
          displayName: ((contact['display_name'] ?? '') as String).isNotEmpty
              ? (contact['display_name'] as String)
              : ((contact['username'] ?? '') as String),
          logoUrl: (contact['logo_url'] ?? '') as String?,
        );
      }).toList();
      notifyListeners();
    } catch (_) {
      // ignore
    }
  }

  Future<void> fetchConversations() async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final token = Session.I.accessToken;
      if (token == null || token.isEmpty) {
        throw Exception('Not authenticated');
      }
  final resp = await _dio.get(
        '/api/conversations/',
        queryParameters: {'limit': 200},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final rawList = resp.data;
      final List data = rawList is List ? rawList : ((rawList is Map) ? (rawList['results'] as List? ?? const []) : const []);
      final meId = Session.I.currentUser?.id;
      final List<MapEntry<Conversation, DateTime?>> convWithTime = data.map((e) {
        final m = e as Map;
        final id = m['id'] as int;
        final userA = (m['user_a'] as Map?) ?? {};
        final userB = (m['user_b'] as Map?) ?? {};
        // pick the other participant to display name
        final aName = (userA['display_name'] ?? userA['username'] ?? '').toString();
        final bName = (userB['display_name'] ?? userB['username'] ?? '').toString();
        final aUsername = (userA['username'] ?? '').toString();
        final bUsername = (userB['username'] ?? '').toString();
        final aId = int.tryParse('${userA['id'] ?? ''}');
        final bId = int.tryParse('${userB['id'] ?? ''}');
        String title;
        String otherUsername;
        if (meId != null) {
          if (aId == meId) {
            title = bName; otherUsername = bUsername;
          } else if (bId == meId) {
            title = aName; otherUsername = aUsername;
          } else {
            // fallback to earlier logic
            final meUsername = Session.I.currentUser?.username ?? '';
            title = (aUsername == meUsername) ? bName : aName;
            otherUsername = (aUsername == meUsername) ? bUsername : aUsername;
          }
        } else {
          final meUsername = Session.I.currentUser?.username ?? '';
          title = (aUsername == meUsername) ? bName : aName;
          otherUsername = (aUsername == meUsername) ? bUsername : aUsername;
        }
        final lastPreview = (m['last_message_preview'] ?? '').toString();
        final lastAt = (m['last_message_at'] ?? '') as String?;
        String timeLabel = '';
        try {
          if (lastAt != null && lastAt.isNotEmpty) {
            final dt = DateTime.tryParse(lastAt);
            if (dt != null) {
              final now = DateTime.now();
              if (dt.day == now.day && dt.month == now.month && dt.year == now.year) {
                timeLabel = _formatTime(dt);
              } else {
                timeLabel = 'أمس'; // بسيط مبدئياً
              }
            }
          }
        } catch (_) {}
        return MapEntry(
          Conversation(
          id: id,
          title: title,
          otherUsername: otherUsername,
          avatarUrl: null,
          lastPreview: lastPreview,
          timeLabel: timeLabel,
          unread: 0,
          isMuted: (m['isMuted'] == true),
          ),
          DateTime.tryParse(lastAt ?? ''),
        );
      }).toList();
      convWithTime.sort((a, b) {
        final ta = a.value;
        final tb = b.value;
        if (ta == null && tb == null) return 0;
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb.compareTo(ta);
      });
      conversations = convWithTime.map((e) => e.key).toList();
      // If empty, try to ensure an admin conversation exists once
      if (conversations.isEmpty) {
        try {
          await _dio.post('/api/ensure_admin_conversation', options: Options(headers: {'Authorization': 'Bearer $token'}));
          final resp2 = await _dio.get(
            '/api/conversations/',
            queryParameters: {'limit': 200},
            options: Options(headers: {'Authorization': 'Bearer $token'}),
          );
          final raw2 = resp2.data;
          final List data2 = raw2 is List ? raw2 : ((raw2 is Map) ? (raw2['results'] as List? ?? const []) : const []);
          final List<MapEntry<Conversation, DateTime?>> conv2 = data2.map((e) {
            final m = e as Map;
            final id = m['id'] as int;
            final userA = (m['user_a'] as Map?) ?? {};
            final userB = (m['user_b'] as Map?) ?? {};
            final aName = (userA['display_name'] ?? userA['username'] ?? '').toString();
            final bName = (userB['display_name'] ?? userB['username'] ?? '').toString();
            final aUsername = (userA['username'] ?? '').toString();
            final bUsername = (userB['username'] ?? '').toString();
            final aId = int.tryParse('${userA['id'] ?? ''}');
            final bId = int.tryParse('${userB['id'] ?? ''}');
            String title;
            String otherUsername;
            if (meId != null) {
              if (aId == meId) {
                title = bName; otherUsername = bUsername;
              } else if (bId == meId) {
                title = aName; otherUsername = aUsername;
              } else {
                final meUsername = Session.I.currentUser?.username ?? '';
                title = (aUsername == meUsername) ? bName : aName;
                otherUsername = (aUsername == meUsername) ? bUsername : aUsername;
              }
            } else {
              final meUsername = Session.I.currentUser?.username ?? '';
              title = (aUsername == meUsername) ? bName : aName;
              otherUsername = (aUsername == meUsername) ? bUsername : aUsername;
            }
            final lastPreview = (m['last_message_preview'] ?? '').toString();
            final lastAt = (m['last_message_at'] ?? '') as String?;
            String timeLabel = '';
            try {
              if (lastAt != null && lastAt.isNotEmpty) {
                final dt = DateTime.tryParse(lastAt);
                if (dt != null) {
                  final now = DateTime.now();
                  if (dt.day == now.day && dt.month == now.month && dt.year == now.year) {
                    timeLabel = _formatTime(dt);
                  } else {
                    timeLabel = 'أمس';
                  }
                }
              }
            } catch (_) {}
            return MapEntry(
              Conversation(
              id: id,
              title: title,
              otherUsername: otherUsername,
              avatarUrl: null,
              lastPreview: lastPreview,
              timeLabel: timeLabel,
              unread: 0,
              isMuted: (m['isMuted'] == true),
              ),
              DateTime.tryParse(lastAt ?? ''),
            );
          }).toList();
          conv2.sort((a, b) {
            final ta = a.value;
            final tb = b.value;
            if (ta == null && tb == null) return 0;
            if (ta == null) return 1;
            if (tb == null) return -1;
            return tb.compareTo(ta);
          });
          conversations = conv2.map((e) => e.key).toList();
        } catch (_) {}
      }
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> fetchMessages(int conversationId) async {
    try {
      final token = Session.I.accessToken;
      if (token == null || token.isEmpty) return;
      Response resp;
      try {
        resp = await _dio.get('/api/conversations/$conversationId/messages/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      } on DioException catch (e) {
        // Fallback to no trailing slash in case router is configured differently
        if ((e.response?.statusCode ?? 0) == 404) {
          resp = await _dio.get('/api/conversations/$conversationId/messages', options: Options(headers: {'Authorization': 'Bearer $token'}));
        } else {
          rethrow;
        }
      }
      // Support both paginated {results: [...]} and raw list [] responses
      List data;
      final raw = resp.data;
      if (raw is List) {
        data = raw;
      } else if (raw is Map && raw['results'] is List) {
        data = (raw['results'] as List);
      } else {
        data = const [];
      }
      final list = <Message>[];
      for (final rawItem in data) {
        try {
          final m = (rawItem as Map);
          final type = (m['type'] ?? m['message_type'] ?? 'text').toString();
          final body = (m['body'] ?? '').toString();
          final created = DateTime.tryParse((m['created_at'] ?? '').toString()) ?? DateTime.now();
          final senderMap = (m['sender'] as Map?) ?? {};
          final senderUsername = (senderMap['username'] ?? '').toString();
          final display = (m['senderDisplay'] ?? senderMap['display_name'] ?? senderMap['username'] ?? '').toString();
          final meUsername = Session.I.currentUser?.username ?? '';
          final isMine = (senderUsername == meUsername);
          // Detect a transaction message either by explicit type or by presence of tx fields
          final dirVal = (m['direction'] ?? m['tx_direction']);
          final amtVal = (m['amount'] ?? m['tx_amount']);
          var symVal = (m['currency_symbol'] ?? m['tx_symbol'] ?? m['symbol']);
          // Try nested currency object for symbol as fallback
          if (symVal == null && m['currency'] is Map) {
            symVal = ((m['currency'] as Map)['symbol']);
          }
          final looksTx = (type == 'transaction') || (dirVal != null && amtVal != null && symVal != null);
          if (looksTx) {
            final dir = dirVal?.toString();
            final note = (m['note'] ?? m['tx_note'])?.toString();
            double? amt;
            if (amtVal is num) amt = amtVal.toDouble();
            amt ??= double.tryParse(amtVal?.toString() ?? '');
            final sym = symVal?.toString();
            if (dir != null && amt != null && sym != null) {
              list.add(Message.tx(
                id: (m['id']).toString(),
                sender: isMine ? Sender.me : Sender.other,
                createdAt: created,
                senderDisplay: display,
                txDirection: dir,
                txAmount: amt,
                txSymbol: sym,
                txNote: (note?.isNotEmpty == true) ? note : null,
              ));
            } else {
              list.add(Message.text(id: (m['id']).toString(), sender: isMine ? Sender.me : Sender.other, text: body, createdAt: created, senderDisplay: display));
            }
          } else {
            list.add(Message.text(id: (m['id']).toString(), sender: isMine ? Sender.me : Sender.other, text: body, createdAt: created, senderDisplay: display));
          }
        } catch (_) {
          // ignore single item parse error
        }
      }
      // Normalize ascending order (oldest -> newest) for stable UI
      list.sort((a, b) {
        final t = a.createdAt.compareTo(b.createdAt);
        if (t != 0) return t;
        return a.id.compareTo(b.id);
      });
      _messagesByConv[conversationId] = list;
      notifyListeners();
    } catch (_) {}
  }

  Future<void> ensureCurrenciesLoaded() async {
    if (currencies.isNotEmpty) return;
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    try {
      final res = await _dio.get('/api/currencies/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final data = res.data;
      List list;
      if (data is List) {
        list = data;
      } else if (data is Map && data['results'] is List) {
        list = data['results'] as List;
      } else {
        list = const [];
      }
      if (list.isEmpty) {
        // Try to bootstrap defaults then refetch
        try {
          await _dio.post('/api/currencies/bootstrap/', options: Options(headers: {'Authorization': 'Bearer $token'}));
          final res2 = await _dio.get('/api/currencies/', options: Options(headers: {'Authorization': 'Bearer $token'}));
          final d2 = res2.data;
          if (d2 is List) {
            list = d2;
          } else if (d2 is Map && d2['results'] is List) {
            list = d2['results'] as List;
          }
        } catch (_) {}
      }
      currencies = list.map((e) => (e as Map).cast<String, dynamic>()).toList();
      // Choose a sensible default (USD) if available; else first active currency
      // If USD exists we'll prefer it lazily in UI as default; no-op here
      notifyListeners();
    } catch (_) {
      // ignore
    }
  }

  void selectCurrencyFor(int conversationId, int currencyId) {
    selectedCurrencyByConv[conversationId] = currencyId;
    notifyListeners();
  }

  Map<String, dynamic>? currencyById(int id) {
    try {
      return currencies.firstWhere((c) => (c['id'] ?? -1) == id);
    } catch (_) {
      return null;
    }
  }

  String? getTempNote(int conversationId) => _tempNoteByConv[conversationId];
  void setTempNote(int conversationId, String note) {
    final v = note.trim();
    if (v.isEmpty) {
      _tempNoteByConv.remove(conversationId);
    } else {
      _tempNoteByConv[conversationId] = v;
    }
    notifyListeners();
  }
  void clearTempNote(int conversationId) {
    if (_tempNoteByConv.remove(conversationId) != null) {
      notifyListeners();
    }
  }

  Future<({bool ok, String? error})> createTransaction({
    required int conversationId,
    required String direction, // 'lna' or 'lkm'
    required String amount,
    String? note,
  }) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return (ok: false, error: 'غير مصرح');
    final curId = selectedCurrencyByConv[conversationId];
    if (curId == null) return (ok: false, error: 'اختر العملة أولاً');
    // Canonicalize amount: replace comma with dot
    final amt = amount.trim().replaceAll(',', '.');
    if (amt.isEmpty) return (ok: false, error: 'أدخل المبلغ');
    try {
      await _dio.post(
        '/api/transactions/',
        data: {
          'conversation': conversationId,
          'currency_id': curId,
          'amount': amt,
          'direction': direction,
          if ((note != null && note.trim().isNotEmpty)) 'note': note.trim() else if ((getTempNote(conversationId) ?? '').isNotEmpty) 'note': getTempNote(conversationId),
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      // Refresh messages and aggregates after transaction
      await fetchMessages(conversationId);
      await refreshConvAggregates(conversationId);
      await fetchConversations();
      return (ok: true, error: null);
    } on DioException catch (e) {
      String? message;
      try {
        final data = e.response?.data;
        if (data is Map) {
          final d = data['detail'] ?? data['error'];
          message = (d is String) ? d : d?.toString();
        } else if (data is String) {
          message = data;
        }
      } catch (_) {}
      message ??= 'تعذر إنشاء المعاملة';
      return (ok: false, error: message);
    } catch (_) {
      return (ok: false, error: 'تعذر إنشاء المعاملة');
    }
  }

  // ---- Aggregates (summary/net balance) ----
  Future<Map<String, int>?> _getConversationMeta(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return null;
    try {
      final resp = await _dio.get('/api/conversations/$conversationId/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final m = (resp.data as Map);
      final ua = (m['user_a'] as Map?) ?? {};
      final ub = (m['user_b'] as Map?) ?? {};
      return {
        'user_a_id': int.tryParse('${ua['id'] ?? ''}') ?? 0,
        'user_b_id': int.tryParse('${ub['id'] ?? ''}') ?? 0,
      };
    } catch (_) {
      return null;
    }
  }

  Future<void> refreshConvAggregates(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    try {
      // Fetch summary + net in parallel; ensure meta for perspective
      final meta = await _getConversationMeta(conversationId);
      final meId = Session.I.currentUser?.id;
      int flip = 1;
      if (meta != null && meId != null && meId > 0) {
        flip = (meId == (meta['user_a_id'] ?? -1)) ? 1 : -1;
      }
      final respNet = await _dio.get(
        '/api/conversations/$conversationId/net_balance/',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final net = (respNet.data as Map);
      final List rows = (net['net'] as List?) ?? const [];
      final map = <String, double>{};
      final sym = <String, String>{};
      for (final row in rows) {
        try {
          final m = row as Map;
          final cur = (m['currency'] as Map?) ?? {};
          final code = (cur['code'] ?? '').toString();
          final symbol = (cur['symbol'] ?? '').toString();
          final raw = m['net_from_user_a_perspective'];
          double val;
          if (raw is num) {
            val = raw.toDouble();
          } else {
            val = double.tryParse(raw?.toString() ?? '0') ?? 0;
          }
          map[code] = (flip * val);
          if (code.isNotEmpty) sym[code] = symbol;
        } catch (_) {}
      }
      pairWalletByConv[conversationId] = map;
      pairSymbolsByConv[conversationId] = sym;
      notifyListeners();
    } catch (_) {
      // ignore failures
    }
  }

  // ---- Conversation Members ----
  Future<List<Map<String, dynamic>>> getConversationMembers(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return [];
    try {
      final resp = await _dio.get(
        '/api/conversations/$conversationId/members/',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final data = (resp.data as Map)['members'] as List?;
      if (data == null) return [];
      return data.cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  Future<void> _sendMessageBackend(int conversationId, String body) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    try {
      final resp = await _dio.post(
        '/api/conversations/$conversationId/send/',
        data: {'body': body},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final m = (resp.data as Map);
      final created = DateTime.tryParse((m['created_at'] ?? '').toString()) ?? DateTime.now();
      final list = _messagesByConv.putIfAbsent(conversationId, () => []);
      list.add(Message.text(
        id: (m['id']).toString(),
        sender: Sender.me,
        text: (m['body'] ?? '').toString(),
        createdAt: created,
        senderDisplay: (m['senderDisplay'] ?? Session.I.currentUser?.displayName ?? Session.I.currentUser?.username ?? '').toString(),
      ));
      notifyListeners();
      fetchConversations();
    } catch (e) {
      // Do not add optimistic message on failure; leave to caller to surface error
    }
  }

  Future<({bool ok, bool otpRequired, String? error})> sendMessageApi(int conversationId, String body, {String? otp}) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return (ok: false, otpRequired: false, error: 'غير مصرح');
    try {
      final headers = {'Authorization': 'Bearer $token', if (otp != null && otp.isNotEmpty) 'X-OTP-Code': otp};
      Response resp;
      try {
        resp = await _dio.post(
          '/api/conversations/$conversationId/send/',
          data: {'body': body},
          options: Options(headers: headers),
        );
      } on DioException catch (e) {
        // Try again without trailing slash if 404 (router without slash)
        if ((e.response?.statusCode ?? 0) == 404) {
          resp = await _dio.post(
            '/api/conversations/$conversationId/send',
            data: {'body': body},
            options: Options(headers: headers),
          );
        } else {
          rethrow;
        }
      }
      final m = (resp.data as Map);
      final created = DateTime.tryParse((m['created_at'] ?? '').toString()) ?? DateTime.now();
      final list = _messagesByConv.putIfAbsent(conversationId, () => []);
      final sent = Message.text(
        id: (m['id']).toString(),
        sender: Sender.me,
        text: (m['body'] ?? '').toString(),
        createdAt: created,
        senderDisplay: (m['senderDisplay'] ?? Session.I.currentUser?.displayName ?? Session.I.currentUser?.username ?? '').toString(),
      );
      list.add(sent);
      notifyListeners();
      // Keep UI in sync and ensure persistence is reflected immediately
      await fetchMessages(conversationId);
      // If the freshly fetched list (due to timing/limit issues) still doesn't contain the sent id, merge it back
      final fetched = _messagesByConv[conversationId] ?? [];
      final exists = fetched.any((e) => e.id == sent.id);
      if (!exists) {
        fetched.add(sent);
        fetched.sort((a, b) {
          final t = a.createdAt.compareTo(b.createdAt);
          if (t != 0) return t;
          return a.id.compareTo(b.id);
        });
        _messagesByConv[conversationId] = fetched;
        notifyListeners();
      }
      fetchConversations();
      return (ok: true, otpRequired: false, error: null);
    } on DioException catch (e) {
      try {
        final data = e.response?.data;
        if (e.response?.statusCode == 403 && data is Map && (data['otp_required'] == true)) {
          return (ok: false, otpRequired: true, error: (data['detail']?.toString() ?? 'OTP مطلوب'));
        }
        final msg = (data is Map ? (data['detail']?.toString()) : (data?.toString())) ?? 'فشل الإرسال';
        return (ok: false, otpRequired: false, error: msg);
      } catch (_) {
        return (ok: false, otpRequired: false, error: 'فشل الإرسال');
      }
    } catch (_) {
      return (ok: false, otpRequired: false, error: 'فشل الإرسال');
    }
  }

  Future<({bool ok, bool otpRequired, String? error})> sendAttachment(
    int conversationId, {
    required String filePath,
    String? fileName,
    String? caption,
    String? otp,
  }) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return (ok: false, otpRequired: false, error: 'غير مصرح');
    try {
      final headers = {
        'Authorization': 'Bearer $token',
        if (otp != null && otp.isNotEmpty) 'X-OTP-Code': otp,
      };
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
        if (caption != null && caption.trim().isNotEmpty) 'body': caption.trim(),
      });
      final resp = await _dio.post(
        '/api/conversations/$conversationId/send_attachment/',
        data: form,
        options: Options(headers: headers, contentType: 'multipart/form-data'),
      );
      final m = (resp.data as Map);
      final created = DateTime.tryParse((m['created_at'] ?? '').toString()) ?? DateTime.now();
      final list = _messagesByConv.putIfAbsent(conversationId, () => []);
      final body = (m['body'] ?? '').toString();
      list.add(Message.text(
        id: (m['id']).toString(),
        sender: Sender.me,
        text: body.isNotEmpty ? body : (m['attachment_name']?.toString() ?? 'مرفق'),
        createdAt: created,
        senderDisplay: (m['senderDisplay'] ?? Session.I.currentUser?.displayName ?? Session.I.currentUser?.username ?? '').toString(),
      ));
      notifyListeners();
      // Ensure server-persisted list is reflected
      await fetchMessages(conversationId);
      fetchConversations();
      return (ok: true, otpRequired: false, error: null);
    } on DioException catch (e) {
      try {
        final data = e.response?.data;
        if (e.response?.statusCode == 403 && data is Map && (data['otp_required'] == true)) {
          return (ok: false, otpRequired: true, error: (data['detail']?.toString() ?? 'OTP مطلوب'));
        }
        final msg = (data is Map ? (data['detail']?.toString()) : (data?.toString())) ?? 'فشل رفع المرفق';
        return (ok: false, otpRequired: false, error: msg);
      } catch (_) {
        return (ok: false, otpRequired: false, error: 'فشل رفع المرفق');
      }
    } catch (_) {
      return (ok: false, otpRequired: false, error: 'فشل رفع المرفق');
    }
  }

  Future<bool> toggleMute(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return false;
    try {
      final idx = conversations.indexWhere((c) => c.id == conversationId);
      if (idx == -1) return false;
      final conv = conversations[idx];
      if (conv.isMuted) {
  await _dio.delete('/api/conversations/$conversationId/mute/', options: Options(headers: {'Authorization': 'Bearer $token'}));
        conversations[idx] = Conversation(
          id: conv.id,
          title: conv.title,
          otherUsername: conv.otherUsername,
          avatarUrl: conv.avatarUrl,
          lastPreview: conv.lastPreview,
          timeLabel: conv.timeLabel,
          unread: conv.unread,
          pinned: conv.pinned,
          isMuted: false,
        );
      } else {
  await _dio.post('/api/conversations/$conversationId/mute/', options: Options(headers: {'Authorization': 'Bearer $token'}));
        conversations[idx] = Conversation(
          id: conv.id,
          title: conv.title,
          otherUsername: conv.otherUsername,
          avatarUrl: conv.avatarUrl,
          lastPreview: conv.lastPreview,
          timeLabel: conv.timeLabel,
          unread: conv.unread,
          pinned: conv.pinned,
          isMuted: true,
        );
      }
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> markRead(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return false;
    try {
  await _dio.post('/api/conversations/$conversationId/read/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> clearChat(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return false;
    try {
  await _dio.post('/api/conversations/$conversationId/clear/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      _messagesByConv[conversationId] = [];
      notifyListeners();
      fetchConversations();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<bool> requestDelete(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return false;
    try {
  await _dio.post('/api/conversations/$conversationId/request_delete/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>?> fetchSummary(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return null;
    try {
  final resp = await _dio.get('/api/conversations/$conversationId/summary/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      return (resp.data as Map).cast<String, dynamic>();
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> fetchMembers(int conversationId) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return [];
    try {
  final resp = await _dio.get('/api/conversations/$conversationId/members/', options: Options(headers: {'Authorization': 'Bearer $token'}));
      final m = (resp.data as Map);
      final List members = m['members'] as List? ?? [];
      return members.map((e) => (e as Map).cast<String, dynamic>()).toList();
    } catch (_) {
      return [];
    }
  }

  Future<int?> createConversationWithUsername(String username) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return null;
    try {
      final resp = await _dio.post(
        '/api/conversations/',
        data: {'other_user_username': username},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final m = (resp.data as Map);
      final cid = int.tryParse('${m['id'] ?? ''}');
      await fetchConversations();
      return cid;
    } catch (_) {
      return null;
    }
  }

  // Verbose variant that propagates backend error messages
  Future<({int? id, String? error})> createConversationWithUsernameVerbose(String username) async {
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return (id: null, error: 'غير مصرح');
    try {
      final resp = await _dio.post(
        '/api/conversations/',
        data: {'other_user_username': username},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final m = (resp.data as Map);
      final cid = int.tryParse('${m['id'] ?? ''}');
      await fetchConversations();
      return (id: cid, error: null);
    } on DioException catch (e) {
      String? message;
      try {
        final data = e.response?.data;
        if (data is Map) {
          final d = data['detail'];
          message = (d is String) ? d : (d?.toString());
        } else if (data is String) {
          message = data;
        }
      } catch (_) {}
      message ??= 'تعذر إنشاء المحادثة';
      return (id: null, error: message);
    } catch (_) {
      return (id: null, error: 'تعذر إنشاء المحادثة');
    }
  }

  Future<void> searchUsers(String query) async {
    userSearchResults = [];
    final q = (query).trim();
    if (q.isEmpty) {
      notifyListeners();
      return;
    }
    final token = Session.I.accessToken;
    if (token == null || token.isEmpty) return;
    try {
      final resp = await _dio.get(
        '/api/users/',
        queryParameters: {
          'q': q,
          'exclude_self': '1',
          'limit': 20,
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      final raw = resp.data;
      final List data = raw is List ? raw : ((raw is Map) ? (raw['results'] as List? ?? const []) : const []);
      userSearchResults = data.map((e) => (e as Map).cast<String, dynamic>()).toList();
      notifyListeners();
    } catch (_) {}
  }

  void clearUserSearch() {
    userSearchResults = [];
    notifyListeners();
  }

  String _formatTime(DateTime dt) {
    var hour = dt.hour;
    final minute = dt.minute.toString().padLeft(2, '0');
    final ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour == 0) hour = 12;
    return '${hour.toString().padLeft(2, '0')}:$minute $ampm';
  }
}
