import 'package:flutter/material.dart';
import 'dart:ui' show FontFeature;
import '../../services/auth_service.dart';
import '../../services/device_fingerprint.dart';

class PinResult {
  final bool success;
  final String? message;
  const PinResult({required this.success, this.message});
}

class _DigitBubble extends StatelessWidget {
  final bool filled;
  const _DigitBubble({required this.filled});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 16,
      height: 16,
      margin: const EdgeInsets.symmetric(horizontal: 6),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? Theme.of(context).colorScheme.primary : Colors.transparent,
        border: Border.all(color: Theme.of(context).colorScheme.primary, width: 1.4),
      ),
    );
  }
}

class PinPageArgs {
  final String? hint;
  const PinPageArgs({this.hint});
}

class PinPage extends StatefulWidget {
  final PinPageArgs? args;
  const PinPage({super.key, this.args});
  @override
  State<PinPage> createState() => _PinPageState();
}

class _PinPageState extends State<PinPage> {
  final _digits = <String>[]; // 6
  int _attempts = 0;
  String? _message;
  bool _busy = false;

  Future<void> _append(String d) async {
    if (_busy) return;
    if (_digits.length >= 6) return;
    setState(() => _digits.add(d));
    if (_digits.length == 6) {
      await _submit();
    }
  }

  Future<void> _submit() async {
    final pin = _digits.join();
    setState(() { _busy = true; _message = null; });
    try {
      final did = await DeviceFingerprintService.getIdentity();
      try {
        // Prefer session-based verification when access token exists,
        // otherwise perform PIN login that issues fresh tokens.
        await AuthService().verifyPin(
          pin: pin,
          fingerprint: did.fingerprint,
          deviceName: did.name,
          platform: did.platform,
        );
      } catch (e) {
        // Fallback to PIN login without session
        await AuthService().loginWithPin(pin: pin);
      }
      if (!mounted) return;
      Navigator.of(context).pop(const PinResult(success: true));
    } catch (e) {
      _attempts += 1;
      final msg = e.toString().replaceFirst('Exception: ', '');
      setState(() { _message = msg; _digits.clear(); });
      // If device not approved/not found/locked -> return to login via caller
      final lower = msg.toLowerCase();
      if (lower.contains('not approved') || lower.contains('not found') || lower.contains('locked')) {
        if (mounted) {
          Navigator.of(context).pop(PinResult(success: false, message: msg));
        }
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: Theme.of(context).colorScheme.surface,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          automaticallyImplyLeading: false,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            tooltip: 'رجوع',
            onPressed: _busy
                ? null
                : () {
                    if (!mounted) return;
                    Navigator.of(context).maybePop(const PinResult(success: false, message: 'cancelled'));
                  },
          ),
          title: const Text('أدخل رمز PIN'),
        ),
        body: Column(
          mainAxisAlignment: MainAxisAlignment.start,
          children: [
            SizedBox(height: MediaQuery.of(context).padding.top + kToolbarHeight + 16),
            Text(widget.args?.hint ?? 'أدخل الرمز المكوّن من 6 أرقام'),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(6, (i) => _DigitBubble(filled: i < _digits.length)),
            ),
            if (_message != null) ...[
              const SizedBox(height: 10),
              Text(_message!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
            if (_attempts > 0) ...[
              const SizedBox(height: 6),
              Text('محاولة $_attempts/5', style: const TextStyle(color: Colors.grey)),
            ],
            const Spacer(),
            _buildKeypad(),
          ],
        ),
      ),
    );
  }

  Widget _buildKeypad() {
    final keys = [
      ['1','2','3'],
      ['4','5','6'],
      ['7','8','9'],
      ['del','0','ok'],
    ];
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Padding(
        padding: const EdgeInsets.only(bottom: 24, left: 24, right: 24, top: 8),
        child: Column(
          children: keys.map((row) {
            return Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: row.map((k) => _buildKey(k)).toList(),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildKey(String k) {
    final isDel = k == 'del';
    final isOk = k == 'ok';
    return Padding(
      padding: const EdgeInsets.all(8.0),
      child: SizedBox(
        width: 84, height: 56,
        child: ElevatedButton(
          onPressed: _busy ? null : () async {
            if (isDel) {
              if (_digits.isNotEmpty) setState(() => _digits.removeLast());
            } else if (isOk) {
              if (_digits.length == 6) await _submit();
            } else {
              await _append(k);
            }
          },
          child: isDel ? const Icon(Icons.backspace_outlined) : (isOk ? const Icon(Icons.check) : Text(k, style: const TextStyle(fontSize: 18, fontFeatures: [FontFeature.tabularFigures()] ))),
        ),
      ),
    );
  }
}
