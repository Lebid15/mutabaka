import 'package:flutter/material.dart';
import '../../services/secure_prefs.dart';
import '../../services/auth_service.dart';
import '../../services/session.dart';
import 'pin_page.dart';
import 'login_page.dart';
import '../home/home_page.dart';

class WelcomePinPage extends StatefulWidget {
  const WelcomePinPage({super.key});
  @override
  State<WelcomePinPage> createState() => _WelcomePinPageState();
}

class _WelcomePinPageState extends State<WelcomePinPage> {
  String _name = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadName();
  }

  Future<void> _loadName() async {
    final me = Session.I.currentUser;
    if (me != null && (me.displayName.isNotEmpty || me.username.isNotEmpty)) {
      setState(() => _name = me.displayName.isNotEmpty ? me.displayName : me.username);
      return;
    }
    final last = await SecurePrefs.getLastUser();
    if (last != null) {
      setState(() => _name = (last.$2.isNotEmpty ? last.$2 : last.$1));
    }
  }

  Future<void> _signInWithPin() async {
    setState(() => _busy = true);
    try {
      // Ask for PIN on a dedicated page
      final res = await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const PinPage()),
      );
      if (!mounted) return;
      if (res is PinResult && res.success) {
        // Session already had access token; PIN verified path handled by PinPage
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomePage()));
        return;
      }
      // If user cancelled or got locked/not approved, do not re-prompt inline
      if (res is PinResult && (res.message?.toLowerCase().contains('locked') == true)) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('الـPIN مقفول مؤقتاً')));
        return;
      }
      // If PinPage didn't handle a session, we can offer an inline fallback
      final pinOk = await _requestPinInline();
      if (!mounted) return;
      if (pinOk) {
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomePage()));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _requestPinInline() async {
    String pin = '';
    final v = await showDialog<String?>(
      context: context,
      builder: (ctx) {
        final ctrl = TextEditingController();
        return AlertDialog(
          title: const Text('أدخل رمز PIN'),
          content: TextField(
            controller: ctrl,
            keyboardType: TextInputType.number,
            maxLength: 6,
            obscureText: true,
            decoration: const InputDecoration(hintText: '******'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(null), child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(ctrl.text), child: const Text('تأكيد')),
          ],
        );
      },
    );
    pin = (v ?? '').trim();
    if (pin.length != 6) return false;
    // Use login-with-pin (verify-pin without Authorization that returns JWT)
    await AuthService().loginWithPin(pin: pin);
    return true;
  }

  Future<void> _switchUser() async {
    await SecurePrefs.clearRememberPinAndUser();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginPage()));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: scheme.surface,
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      _name.isNotEmpty ? 'أهلاً، $_name' : 'أهلاً',
                      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: FilledButton(
                        onPressed: _busy ? null : _signInWithPin,
                        style: FilledButton.styleFrom(backgroundColor: scheme.primary),
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                            : const Text('تسجيل الدخول باستخدام الـPIN'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: _busy ? null : _switchUser,
                      child: const Text('تبديل المستخدم'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
