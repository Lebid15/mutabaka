import 'package:flutter/material.dart';

/// Simple app-wide theme controller.
/// Defaults to ThemeMode.dark (existing app colors), can toggle to ThemeMode.light (WhatsApp-like).
class ThemeController extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.light;
  ThemeMode get mode => _mode;

  static final ThemeController I = ThemeController._();
  ThemeController._();

  void toggle() {
    _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }

  void setMode(ThemeMode m) {
    if (m == _mode) return;
    _mode = m;
    notifyListeners();
  }
}
