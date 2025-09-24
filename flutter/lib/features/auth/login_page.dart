import 'package:flutter/material.dart';
import 'login_controller.dart';
import '../home/home_page.dart';
import '../../theme/theme_controller.dart';
import 'pin_page.dart';
import '../../services/secure_prefs.dart';
import '../../services/session.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _idCtrl = TextEditingController();
  final _pwdCtrl = TextEditingController();
  final _controller = LoginController();
  bool _obscure = true;
  bool _remember = false;
  bool _valid = false;
  bool _showOtp = false;
  final _otpCtrl = TextEditingController();

  @override
  void dispose() {
    _idCtrl.dispose();
    _pwdCtrl.dispose();
    _otpCtrl.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    void recompute() {
      final ok = _idCtrl.text.trim().isNotEmpty && _pwdCtrl.text.length >= 6;
      if (ok != _valid) setState(() => _valid = ok);
    }
    _idCtrl.addListener(recompute);
    _pwdCtrl.addListener(recompute);
  }

  Future<void> _onLogin() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    await _controller.login(
      identifier: _idCtrl.text.trim(),
      password: _pwdCtrl.text,
      rememberMe: _remember,
      otp: _controller.otpRequired ? _otpCtrl.text.trim() : null,
    );
    if (_controller.isSuccess) {
      if (mounted) {
        // Persist remember flag and last user for PIN greeting
        final me = Session.I.currentUser;
        if (me != null) {
          await SecurePrefs.setRememberPin(true);
          await SecurePrefs.setLastUser(username: me.username, displayName: me.displayName);
        }
        // If backend generated a PIN on first mobile login, show it once
        if (_controller.generatedPinOnce != null) {
          final pin = _controller.generatedPinOnce!;
          await showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('رمز PIN جديد'),
              content: Text('احفظ هذا الرمز لاستخدامه لاحقًا:\n\n$pin'),
              actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('حسناً'))],
            ),
          );
        }
        // If PIN is required, navigate to PIN entry
        if (_controller.pinRequired) {
          if (!mounted) return;
          final ok = await Navigator.of(context).push<bool>(
            MaterialPageRoute(builder: (_) => const PinPage()),
          );
          if (ok != true) return; // user backed out
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تسجيل الدخول بنجاح'),
            behavior: SnackBarBehavior.floating,
            duration: Duration(seconds: 1),
          ),
        );
        // Navigate to Home after a brief delay to show the snackbar
        await Future<void>.delayed(const Duration(milliseconds: 400));
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomePage()),
        );
      }
    } else if (_controller.isError) {
      if (_controller.otpRequired && !_showOtp) {
        setState(() => _showOtp = true);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_controller.errorMessage ?? 'حدث خطأ'),
            backgroundColor: Theme.of(context).colorScheme.error,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: scheme.surface,
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth;
              final maxFormWidth = width > 600 ? 440.0 : width * 0.9;
              return AnimatedBuilder(
                animation: _controller,
                builder: (context, _) {
                  final isLoading = _controller.isLoading;
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(maxWidth: maxFormWidth),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            // Header pinned at top: bell (left), centered logo+title, theme toggle (right)
                            SizedBox(
                              height: 48,
                              child: Stack(
                                children: [
                                  Align(
                                    alignment: Alignment.centerLeft,
                                    child: IconButton(
                                      onPressed: () {},
                                      icon: const Icon(Icons.notifications_none_rounded),
                                    ),
                                  ),
                                  Center(
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Image.asset(
                                          'assets/images/logo.png',
                                          height: 50, // larger logo
                                          errorBuilder: (c, e, s) => const SizedBox.shrink(),
                                        ),
                                        const SizedBox(width: 8),
                                        const Text('مطابقة', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                                      ],
                                    ),
                                  ),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: IconButton(
                                      tooltip: 'تبديل الثيم',
                                      onPressed: () => ThemeController.I.toggle(),
                                      icon: Icon(
                                        Theme.of(context).brightness == Brightness.light
                                            ? Icons.dark_mode_outlined
                                            : Icons.light_mode_outlined,
                                      ), // sun/moon icon
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 24),

                            // Avatar with nicer style: wavy mint blob background + ring + soft shadow
                            SizedBox(
                              width: 260,
                              height: 230,
                              child: Stack(
                                alignment: Alignment.center,
                                children: [
                                  Positioned.fill(
                                    child: CustomPaint(
                                      painter: _WavyBlobPainter(color: scheme.secondary.withValues(alpha: 0.20)),
                                    ),
                                  ),
                                  Container(
                                    decoration: const BoxDecoration(
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: Color(0x1A000000), // ~6% black
                                          blurRadius: 20,
                                          offset: Offset(0, 10),
                                        ),
                                      ],
                                    ),
                                    child: CircleAvatar(
                                      radius: 62,
                                      backgroundColor: Colors.white,
                                      child: CircleAvatar(
                                        radius: 56,
                                        backgroundColor: Colors.grey.shade200,
                                        child: Icon(Icons.person, size: 56, color: Colors.grey.shade500),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),

                            const SizedBox(height: 28),

                                Form(
                                  key: _formKey,
                                  autovalidateMode: AutovalidateMode.onUserInteraction,
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.stretch,
                                    children: [
                                      // Username field
                                      TextFormField(
                                        controller: _idCtrl,
                                        textInputAction: TextInputAction.next,
                                        keyboardType: TextInputType.text,
                                        autofillHints: const [AutofillHints.username],
                                        decoration: const InputDecoration(
                                          hintText: 'ادخل اسم المستخدم',
                                        ),
                                        validator: (v) {
                                          if (v == null || v.trim().isEmpty) {
                                            return 'الحقل مطلوب';
                                          }
                                          return null;
                                        },
                                      ),
                                      const SizedBox(height: 16),
                                      // Password field
                                      TextFormField(
                                        controller: _pwdCtrl,
                                        obscureText: _obscure,
                                        textInputAction: TextInputAction.done,
                                        autofillHints: const [AutofillHints.password],
                                        onFieldSubmitted: (_) => _onLogin(),
                                        decoration: InputDecoration(
                                          hintText: 'ادخل كلمة المرور',
                                          suffixIcon: IconButton(
                                            onPressed: () => setState(() => _obscure = !_obscure),
                                            icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                                          ),
                                        ),
                                        validator: (v) {
                                          if (v == null || v.isEmpty) {
                                            return 'الحقل مطلوب';
                                          }
                                          if (v.length < 6) {
                                            return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
                                          }
                                          return null;
                                        },
                                      ),

                                      const SizedBox(height: 12),
                                      // Remember me only
                                      Align(
                                        alignment: Alignment.centerRight,
                                        child: CheckboxListTile(
                                          contentPadding: EdgeInsets.zero,
                                          controlAffinity: ListTileControlAffinity.leading,
                                          value: _remember,
                                          onChanged: (v) => setState(() => _remember = v ?? false),
                                          title: const Text('تذكرني'),
                                        ),
                                      ),

                                      const SizedBox(height: 8),
                                      SizedBox(
                                        height: 52,
                                        child: FilledButton(
                                          onPressed: (!isLoading && _valid) ? _onLogin : null,
                                          style: FilledButton.styleFrom(backgroundColor: scheme.primary),
                                          child: isLoading
                                              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                                              : const Text('تسجيل الدخول'),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                          ],
                        ),
                      ),
                    ),
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

// A simple wavy blob painter to create an organic mint background behind the avatar
class _WavyBlobPainter extends CustomPainter {
  final Color color;
  _WavyBlobPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    final w = size.width;
    final h = size.height;
    final path = Path();
    // Start near top-left
    path.moveTo(w * 0.1, h * 0.3);
    // upper curve
    path.cubicTo(w * 0.25, h * 0.1, w * 0.75, h * 0.1, w * 0.9, h * 0.3);
    // right curve down
    path.cubicTo(w * 1.0, h * 0.5, w * 0.85, h * 0.85, w * 0.6, h * 0.9);
    // bottom left curve
    path.cubicTo(w * 0.35, h * 0.95, w * 0.05, h * 0.8, w * 0.1, h * 0.55);
    path.close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _WavyBlobPainter oldDelegate) => oldDelegate.color != color;
}
