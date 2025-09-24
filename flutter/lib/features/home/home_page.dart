import 'package:flutter/material.dart';
import 'dart:ui' show ImageFilter;
import 'dart:async';
import 'home_controller.dart';
import 'chat_page.dart';
import '../profile/profile_page.dart';
import '../matches/matches_page.dart';
import '../settings/settings_page.dart';
import '../subscriptions/subscriptions_page.dart';
import '../../services/session.dart';
import '../../services/auth_service.dart';
import '../auth/welcome_pin_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _controller = HomeController();
  final _inputCtrl = TextEditingController();
  bool _initialized = false;

  @override
  void dispose() {
    _controller.dispose();
    _inputCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final divider = Theme.of(context).dividerColor;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Scaffold(
          backgroundColor: scheme.surface,
          body: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              // Kick off first load once
              if (!_initialized) {
                _initialized = true;
                _controller.init();
              }
              return LayoutBuilder(
                builder: (context, c) {
                  final isWide = c.maxWidth >= 700; // tablet/desktop split view
                  // Header + body
                  return Column(
                    children: [
                      // Header (like SidebarHeaderAddContact simplified)
                      _HeaderBar(controller: _controller),

                      // Body
                      Expanded(
                        child: isWide
                            ? Row(
                                children: [
                                  // Sidebar list (fixed width)
                                  SizedBox(
                                    width: 300,
                                    child: _ConversationsList(
                                      controller: _controller,
                                      onTap: (id) => _controller.selectConversation(id),
                                      divider: divider,
                                    ),
                                  ),
                                  // Chat area
                                  Expanded(
                                    child: _controller.selectedId == null
                                        ? _EmptyChatPlaceholder()
                                        : _WideChatArea(controller: _controller),
                                  ),
                                ],
                              )
                            : (_controller.loading
                                ? const Center(child: CircularProgressIndicator())
                                : (_controller.conversations.isEmpty
                                    ? _EmptyState(onCreateAdmin: () async {
                                        final cid = await _controller.ensureAdminConversation();
                                        if (cid != null) {
                                          if (!context.mounted) return;
                                          _controller.fetchMessages(cid);
                                          Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (_) => ChatPage(controller: _controller, conversationId: cid),
                                            ),
                                          );
                                        }
                                      })
                                    : _ConversationsList(
                                        controller: _controller,
                                        onTap: (id) {
                                          _controller.fetchMessages(id);
                                          Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (_) => ChatPage(controller: _controller, conversationId: id),
                                            ),
                                          );
                                        },
                                        divider: divider,
                                      ))),
                      ),
                    ],
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }
}

// Removed old _IconBtn (unused)

class _FrostedCircleIcon extends StatelessWidget {
  final IconData icon;
  final double size;
  final double iconSize;
  const _FrostedCircleIcon({required this.icon, this.size = 28, this.iconSize = 16});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Backdrop blur
          BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 6, sigmaY: 6),
            child: Container(
              width: size,
              height: size,
              color: Colors.white.withValues(alpha: 0.06),
            ),
          ),
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
          ),
          Icon(icon, size: iconSize, color: Colors.white60),
        ],
      ),
    );
  }
}

class _EmptyChatPlaceholder extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Text('اختر محادثة لعرض الرسائل', style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7))),
    );
  }
}

class _WideChatArea extends StatelessWidget {
  final HomeController controller;
  const _WideChatArea({required this.controller});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final divider = Theme.of(context).dividerColor;
    final conv = controller.getConversation(controller.selectedId!);
    // Ensure messages loaded for this conversation
    controller.fetchMessages(controller.selectedId!);
    return Column(
      children: [
        // Chat header minimal
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFF111B21),
            border: Border(bottom: BorderSide(color: divider)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Text(
                conv?.title ?? 'محادثة',
                style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w600),
              ),
              const Spacer(),
              Icon(Icons.search, color: scheme.onSurface.withValues(alpha: 0.8), size: 20),
              const SizedBox(width: 6),
              IconButton(
                tooltip: (conv?.isMuted ?? false) ? 'إلغاء الكتم' : 'كتم',
                onPressed: () {
                  if (controller.selectedId != null) {
                    controller.toggleMute(controller.selectedId!);
                  }
                },
                icon: Icon((conv?.isMuted ?? false) ? Icons.volume_up : Icons.volume_off, color: scheme.onSurface),
              ),
              PopupMenuButton<String>(
                iconColor: scheme.onSurface,
                onSelected: (v) async {
                  final id = controller.selectedId;
                  if (id == null) return;
                  if (v == 'clear') {
                    await controller.clearChat(id);
                  } else if (v == 'delete') {
                    await controller.requestDelete(id);
                  }
                },
                itemBuilder: (context) => const [
                  PopupMenuItem(value: 'clear', child: Text('مسح المحادثة')),
                  PopupMenuItem(value: 'delete', child: Text('طلب حذف المحادثة')),
                ],
              ),
            ],
          ),
        ),

        // Messages list
        Expanded(
          child: Container(
            color: scheme.surface,
            child: ListView.builder(
              reverse: true,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              itemCount: controller.messages.length,
              itemBuilder: (context, idx) {
                final msg = controller.messages[controller.messages.length - 1 - idx];
                final isMine = msg.sender == Sender.me;
                if (msg.text != null) {
                  return Align(
                    alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      constraints: const BoxConstraints(maxWidth: 500),
                      margin: const EdgeInsets.symmetric(vertical: 4),
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
                      child: Text(
                        msg.text!,
                        style: const TextStyle(color: Colors.white, fontSize: 13),
                      ),
                    ),
                  );
                } else {
                  final dir = msg.txDirection;
                  final sign = dir == 'lna' ? '+' : '-';
                  return Align(
                    alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      constraints: const BoxConstraints(maxWidth: 500),
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: isMine ? const Color(0xFF005C4B) : const Color(0xFF202C33),
                        borderRadius: const BorderRadius.only(
                          topLeft: Radius.circular(16),
                          topRight: Radius.circular(16),
                          bottomLeft: Radius.circular(4),
                          bottomRight: Radius.circular(16),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.receipt_long, size: 14, color: Colors.white70),
                              const SizedBox(width: 6),
                              const Text('معاملة', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: dir == 'lna' ? const Color(0x4D16A34A) : const Color(0x4DEF4444),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  dir == 'lna' ? 'لنا' : 'لكم',
                                  style: TextStyle(
                                    color: dir == 'lna' ? const Color(0xFFBBF7D0) : const Color(0xFFFCA5A5),
                                    fontSize: 10,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text('$sign ${msg.txAmount?.toStringAsFixed(2)} ${msg.txSymbol}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12)),
                          if (msg.txNote != null) ...[
                            const SizedBox(height: 3),
                            Text(msg.txNote!, style: const TextStyle(color: Colors.white70, fontSize: 10)),
                          ],
                        ],
                      ),
                    ),
                  );
                }
              },
            ),
          ),
        ),

        // Input bar with keyboard insets
        Container(
          decoration: BoxDecoration(
            color: const Color(0xFF111B21),
            border: Border(top: BorderSide(color: divider)),
          ),
          padding: EdgeInsets.only(
            left: 10,
            right: 10,
            top: 8,
            bottom: 8 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  minLines: 1,
                  maxLines: 4,
                  style: TextStyle(color: scheme.onSurface, fontSize: 14),
                  decoration: InputDecoration(
                    hintText: 'اكتب رسالة…',
                    hintStyle: TextStyle(color: scheme.onSurface.withValues(alpha: 0.6)),
                  ),
                  onSubmitted: (text) {
                    controller.sendMessage(text);
                  },
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 44,
                child: FilledButton(
                  onPressed: () {
                    // No-op here; the dedicated ChatPage handles mobile sending.
                  },
                  child: const Icon(Icons.send, size: 18),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ConversationsList extends StatelessWidget {
  final HomeController controller;
  final void Function(int id) onTap;
  final Color divider;
  const _ConversationsList({required this.controller, required this.onTap, required this.divider});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF111B21), // chatPanel
        border: Border(right: BorderSide(color: divider)),
      ),
      child: ListView.separated(
        padding: EdgeInsets.zero,
        itemCount: controller.conversations.length,
        separatorBuilder: (_, __) => Divider(height: 1, color: divider.withValues(alpha: 0.3)),
        itemBuilder: (context, idx) {
          final item = controller.conversations[idx];
          final selected = item.id == controller.selectedId;
          return Material(
            color: selected ? Colors.white.withValues(alpha: 0.04) : Colors.transparent,
            child: InkWell(
              onTap: () => onTap(item.id),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Row(
                  children: [
                    // Avatar
                    CircleAvatar(
                      radius: 22,
                      backgroundColor: Colors.blueGrey,
                      backgroundImage: item.avatarUrl != null ? NetworkImage(item.avatarUrl!) : null,
                      child: item.avatarUrl == null
                          ? Text(
                              (item.title.isNotEmpty ? item.title.trim()[0] : '?').toUpperCase(),
                              style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.white),
                            )
                          : null,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.max,
                            textDirection: TextDirection.rtl,
                            children: [
                              Flexible(
                                child: Text(
                                  item.title,
                                  style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w700, fontSize: 15),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                item.timeLabel,
                                style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.65), fontSize: 12),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  item.lastPreview,
                                  style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.9), fontSize: 13),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (item.unread > 0)
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF16A34A),
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                  child: Text('${item.unread}', style: const TextStyle(color: Colors.white, fontSize: 11)),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    // Edit icon on the far side
                    const _FrostedCircleIcon(icon: Icons.edit, size: 28, iconSize: 15),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final Future<void> Function() onCreateAdmin;
  const _EmptyState({required this.onCreateAdmin});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline, size: 48, color: scheme.onSurface.withValues(alpha: 0.7)),
          const SizedBox(height: 12),
          Text('لا توجد محادثات بعد', style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.8))),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () async {
              await onCreateAdmin();
            },
            icon: const Icon(Icons.support_agent),
            label: const Text('ابدأ محادثة مع الدعم'),
          ),
        ],
      ),
    );
  }
}

class _HeaderBar extends StatefulWidget {
  final HomeController controller;
  const _HeaderBar({required this.controller});

  @override
  State<_HeaderBar> createState() => _HeaderBarState();
}

class _HeaderBarState extends State<_HeaderBar> {
  final _searchCtrl = TextEditingController();
  final _searchFocus = FocusNode();
  bool _open = false;
  Timer? _debounce;

  void _toast(BuildContext context, String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg, textDirection: TextDirection.rtl)),
    );
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final divider = Theme.of(context).dividerColor;
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        return Container(
          decoration: BoxDecoration(
            color: const Color(0xFF111B21),
            border: Border(bottom: BorderSide(color: divider)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            children: [
              // Header row: Title + plus on the same side, menu at the far side
              Row(
                children: [
                  Text('الدردشات', style: TextStyle(color: scheme.onSurface, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () {
                      setState(() {
                        _open = !_open;
                        if (_open) {
                          WidgetsBinding.instance.addPostFrameCallback((_) {
                            _searchFocus.requestFocus();
                          });
                        } else {
                          _searchCtrl.clear();
                          widget.controller.clearUserSearch();
                        }
                      });
                    },
                    child: const _FrostedCircleIcon(icon: Icons.add, size: 28, iconSize: 18),
                  ),
                  const Spacer(),
                  PopupMenuButton<String>(
                    tooltip: 'القائمة',
                    position: PopupMenuPosition.under,
                    icon: const Icon(Icons.more_vert, color: Colors.white70),
                    onSelected: (v) async {
                      switch (v) {
                        case 'profile':
                          if (!mounted) return; 
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const ProfilePage()),
                          );
                          break;
                        case 'matches':
                          if (!mounted) return;
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const MatchesPage()),
                          );
                          break;
                        case 'settings':
                          if (!mounted) return;
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const SettingsPage()),
                          );
                          break;
                        case 'subscriptions':
                          if (!mounted) return;
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const SubscriptionsPage()),
                          );
                          break;
                        case 'team':
                          _toast(context, 'فريق العمل');
                          break;
                        case 'refresh-contacts':
                          await widget.controller.fetchContacts();
                          _toast(context, 'تم تحديث جهات الاتصال');
                          break;
                        
                        case 'logout':
                          // Clear tokens only; keep device trust + last user for PIN
                          await AuthService().clearTokens();
                          Session.I.clear();
                          if (!mounted) return;
                          // Route user to PIN gate if remember flag is set; otherwise Login
                          Navigator.of(context).pushAndRemoveUntil(
                            MaterialPageRoute(builder: (_) => const WelcomePinPage()),
                            (route) => false,
                          );
                          break;
                      }
                    },
                    itemBuilder: (context) {
                      final items = <PopupMenuEntry<String>>[];
                      items.add(const PopupMenuItem(value: 'profile', child: Text('بروفايلي')));
                      if (!Session.I.isTeamActor) {
                        items.add(const PopupMenuItem(value: 'matches', child: Text('مطابقاتي')));
                      }
                      items.add(const PopupMenuItem(value: 'settings', child: Text('الإعدادات')));
                      if (!Session.I.isTeamActor) {
                        items.add(const PopupMenuItem(value: 'subscriptions', child: Text('الاشتراك')));
                        items.add(const PopupMenuItem(value: 'team', child: Text('فريق العمل')));
                      }
                      items.add(const PopupMenuDivider());
                      items.add(const PopupMenuItem(value: 'refresh-contacts', child: Text('تحديث جهات الاتصال')));
                      items.add(const PopupMenuDivider());
                      items.add(const PopupMenuItem(value: 'logout', child: Text('خروج', style: TextStyle(color: Colors.redAccent))));
                      return items;
                    },
                  ),
                ],
              ),
              if (_open) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    SizedBox(
                      width: 120,
                      child: FilledButton.tonal(
                        onPressed: () {
                          widget.controller.searchUsers(_searchCtrl.text);
                        },
                        child: const Text('بحث'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        focusNode: _searchFocus,
                        decoration: const InputDecoration(hintText: 'ابحث باسم المستخدم أو الاسم الظاهر'),
                        keyboardType: TextInputType.text,
                        textInputAction: TextInputAction.search,
                        textDirection: TextDirection.rtl,
                        textAlign: TextAlign.right,
                        onChanged: (v) {
                          _debounce?.cancel();
                          _debounce = Timer(const Duration(milliseconds: 350), () {
                            widget.controller.searchUsers(v);
                          });
                        },
                        onSubmitted: (v) => widget.controller.searchUsers(v),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Builder(builder: (context) {
                  final hasQuery = _searchCtrl.text.trim().isNotEmpty;
                  if (!hasQuery) return const SizedBox.shrink();
                  final results = widget.controller.userSearchResults;
                  if (results.isEmpty) {
                    return Align(
                      alignment: Alignment.centerRight,
                      child: Text('لا نتائج', style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.7), fontSize: 12)),
                    );
                  }
                  return Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFF0B141A),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.white24),
                    ),
                    constraints: const BoxConstraints(maxHeight: 260),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: results.length,
                      itemBuilder: (context, idx) {
                        final u = results[idx];
                        final display = (u['display_name'] ?? '').toString().isNotEmpty ? u['display_name'] : u['username'];
                        final logo = (u['logo_url'] ?? '') as String?;
                        return ListTile(
                          dense: true,
                          leading: CircleAvatar(
                            backgroundImage: (logo != null && logo.isNotEmpty) ? NetworkImage(logo) : null,
                            child: (logo == null || logo.isEmpty) ? Text(((display as String).isNotEmpty ? display[0] : '?').toUpperCase()) : null,
                          ),
                          title: Text(display as String),
                          subtitle: Text('@${u['username']}', textDirection: TextDirection.ltr),
                          trailing: TextButton(
                            onPressed: () async {
                              final res = await widget.controller.createConversationWithUsernameVerbose(u['username']);
                              if (res.id != null) {
                                widget.controller.clearUserSearch();
                                _searchCtrl.clear();
                                setState(() => _open = false);
                                if (!context.mounted) return;
                                Navigator.of(context).push(
                                  MaterialPageRoute(builder: (_) => ChatPage(controller: widget.controller, conversationId: res.id!)),
                                );
                              } else if (res.error != null && context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(res.error!, textDirection: TextDirection.rtl)),
                                );
                              }
                            },
                            child: const Text('بدء محادثة'),
                          ),
                          onTap: () async {
                            final res = await widget.controller.createConversationWithUsernameVerbose(u['username']);
                            if (res.id != null) {
                              widget.controller.clearUserSearch();
                              _searchCtrl.clear();
                              setState(() => _open = false);
                              if (!context.mounted) return;
                              Navigator.of(context).push(
                                MaterialPageRoute(builder: (_) => ChatPage(controller: widget.controller, conversationId: res.id!)),
                              );
                            } else if (res.error != null && context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(res.error!, textDirection: TextDirection.rtl)),
                              );
                            }
                          },
                        );
                      },
                    ),
                  );
                }),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _NewChatDialog extends StatefulWidget {
  final HomeController controller;
  const _NewChatDialog({required this.controller});

  @override
  State<_NewChatDialog> createState() => _NewChatDialogState();
}

class _NewChatDialogState extends State<_NewChatDialog> {
  String _username = '';
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final contacts = widget.controller.contacts;
    return AlertDialog(
      title: const Text('بدء محادثة جديدة'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              decoration: const InputDecoration(labelText: 'اسم المستخدم'),
              onChanged: (v) => setState(() => _username = v.trim()),
              onSubmitted: (_) => _createByUsername(),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: Text('أو اختر من جهات الاتصال', style: Theme.of(context).textTheme.bodySmall),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 200,
              child: contacts.isEmpty
                  ? const Center(child: Text('لا توجد جهات اتصال'))
                  : ListView.builder(
                      itemCount: contacts.length,
                      itemBuilder: (context, idx) {
                        final c = contacts[idx];
                        return ListTile(
                          leading: CircleAvatar(
                            backgroundImage: (c.logoUrl != null && c.logoUrl!.isNotEmpty) ? NetworkImage(c.logoUrl!) : null,
                            child: (c.logoUrl == null || c.logoUrl!.isEmpty)
                                ? Text((c.displayName.isNotEmpty ? c.displayName[0] : c.username[0]).toUpperCase())
                                : null,
                          ),
                          title: Text(c.displayName),
                          subtitle: Text('@${c.username}', textDirection: TextDirection.ltr),
                          onTap: () async {
                            if (_busy) return;
                            setState(() => _busy = true);
                            final cid = await widget.controller.createConversationWithUsername(c.username);
                            setState(() => _busy = false);
                            if (cid != null && context.mounted) {
                              Navigator.of(context).pop(cid);
                            }
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: const Text('إلغاء')),
        FilledButton(onPressed: _busy ? null : _createByUsername, child: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('ابدأ')),
      ],
    );
  }

  Future<void> _createByUsername() async {
    final u = _username.trim();
    if (u.isEmpty) return;
    setState(() => _busy = true);
    final cid = await widget.controller.createConversationWithUsername(u);
    setState(() => _busy = false);
    if (cid != null && mounted) {
      Navigator.of(context).pop(cid);
    }
  }
}
