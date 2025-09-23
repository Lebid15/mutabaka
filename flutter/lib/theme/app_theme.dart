// ignore_for_file: constant_identifier_names
import 'package:flutter/material.dart';

// Extracted from frontend (tailwind.config.js + usage in page.tsx):
// chatBg:        #0b141a  -> surface
// text-gray-100: #f3f4f6  -> onSurface (Tailwind gray-100)
// green-600:     #16a34a  -> primary (used for buttons/accents)
// green-700:     #15803d  -> hover state (used in states via Material overlays)
// chatDivider:   #233138  -> input borders (default/unfocused)
// bubbleSent:    #005c4b  -> secondary accent
// red-500:       #ef4444  -> error
// on* against solid colors uses white where appropriate

class AppTheme {
  // Web tokens
  static const PRIMARY_HEX = 0xFF16A34A; // Tailwind green-600
  static const ON_PRIMARY_HEX = 0xFFFFFFFF;
  static const SECONDARY_HEX = 0xFF005C4B; // bubbleSent
  static const SURFACE_HEX = 0xFF0B141A; // chatBg
  static const ON_SURFACE_HEX = 0xFFF3F4F6; // text-gray-100
  static const GREEN700_HEX = 0xFF15803D; // Tailwind green-700 (hover)
  static const ERROR_HEX = 0xFFEF4444; // red-500
  static const ON_ERROR_HEX = 0xFFFFFFFF;

  static const DIVIDER_HEX = 0xFF233138; // chatDivider
  static const PANEL_HEX = 0xFF111B21; // chatPanel (slightly lighter than chatBg)

  // Light mode (WhatsApp-like) palette derived from screenshot
  static const LIGHT_BG_HEX = 0xFFF2F7F5; // very light mint/gray background
  static const LIGHT_PANEL_HEX = 0xFFFFFFFF; // white cards/panels if needed
  static const LIGHT_PRIMARY_HEX = 0xFF16A34A; // green accents remain
  static const LIGHT_ACCENT_HEX = 0xFF7BC5B0; // mint watercolor accent
  static const LIGHT_TEXT_HEX = 0xFF1F2937; // slate-800
  static const LIGHT_SUBTEXT_HEX = 0xFF6B7280; // gray-500
  static const LIGHT_OUTLINE_HEX = 0xFFA7D1C7; // mint border similar to button outline

  // Fonts
  // NOTE: Web uses Geist via next/font. To match 1:1, bundle Geist TTF/OTF
  // and set FONT_FAMILY_NAME = 'Geist'. Until then, Flutter will fallback.
  static const FONT_FAMILY_NAME = 'Geist';

  static ThemeData buildTheme(Brightness brightness) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: const Color(PRIMARY_HEX),
      onPrimary: const Color(ON_PRIMARY_HEX),
      secondary: const Color(SECONDARY_HEX),
      onSecondary: Colors.white,
      error: const Color(ERROR_HEX),
      onError: const Color(ON_ERROR_HEX),
      surface: const Color(SURFACE_HEX),
      onSurface: const Color(ON_SURFACE_HEX),
    );

    const radius = 12.0; // per web rounding

    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radius),
      borderSide: const BorderSide(color: Color(DIVIDER_HEX), width: 1),
    );
    final focusedBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radius),
      borderSide: const BorderSide(color: Color(PRIMARY_HEX), width: 1.5),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: const Color(SURFACE_HEX),
      fontFamily: FONT_FAMILY_NAME,
      inputDecorationTheme: InputDecorationTheme(
        isDense: false,
        filled: true,
        fillColor: const Color(PANEL_HEX),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: border,
        enabledBorder: border,
        focusedBorder: focusedBorder,
        errorBorder: border.copyWith(borderSide: const BorderSide(color: Color(ERROR_HEX)) ),
        focusedErrorBorder: focusedBorder,
        labelStyle: TextStyle(
          color: const Color(ON_SURFACE_HEX).withValues(alpha: 0.9),
        ),
        hintStyle: TextStyle(
          color: const Color(ON_SURFACE_HEX).withValues(alpha: 0.6),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          // Avoid infinite width in unbounded layouts (Row inside scroll views)
          // Set a finite min width and fixed min height 48px.
          minimumSize: const WidgetStatePropertyAll(Size(56, 48)),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
          ),
          padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          textStyle: const WidgetStatePropertyAll(TextStyle(fontWeight: FontWeight.w600)),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.pressed) || states.contains(WidgetState.hovered)) {
              return const Color(GREEN700_HEX);
            }
            return const Color(PRIMARY_HEX);
          }),
          foregroundColor: const WidgetStatePropertyAll(Color(ON_PRIMARY_HEX)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: const WidgetStatePropertyAll(Color(PRIMARY_HEX)),
          overlayColor: WidgetStatePropertyAll(const Color(PRIMARY_HEX).withValues(alpha: 0.08)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(SURFACE_HEX),
        contentTextStyle: const TextStyle(color: Color(ON_SURFACE_HEX)),
        actionTextColor: const Color(PRIMARY_HEX),
      ),
      dividerColor: const Color(DIVIDER_HEX),
      textTheme: const TextTheme(
        headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
        labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        bodyMedium: TextStyle(fontSize: 14),
      ),
    );
  }

  /// New Light Mode matching WhatsApp-like palette from screenshot
  static ThemeData lightMode() {
    final colorScheme = const ColorScheme(
      brightness: Brightness.light,
      primary: Color(LIGHT_PRIMARY_HEX),
      onPrimary: Colors.white,
      secondary: Color(LIGHT_ACCENT_HEX),
      onSecondary: Colors.white,
      error: Color(ERROR_HEX),
      onError: Colors.white,
      surface: Color(LIGHT_BG_HEX),
      onSurface: Color(LIGHT_TEXT_HEX),
    );

    const radius = 20.0; // rounder per screenshot

    final outline = const Color(LIGHT_OUTLINE_HEX);

    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radius),
      borderSide: BorderSide(color: outline, width: 1.5),
    );
    final focusedBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(radius),
      borderSide: const BorderSide(color: Color(LIGHT_PRIMARY_HEX), width: 2),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: const Color(LIGHT_BG_HEX),
      fontFamily: FONT_FAMILY_NAME,
      inputDecorationTheme: InputDecorationTheme(
        isDense: false,
        filled: false,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        border: border,
        enabledBorder: border,
        focusedBorder: focusedBorder,
        labelStyle: const TextStyle(color: Color(LIGHT_SUBTEXT_HEX)),
        hintStyle: const TextStyle(color: Color(LIGHT_SUBTEXT_HEX)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size(56, 52)),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
          ),
          padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 18, vertical: 14)),
          textStyle: const WidgetStatePropertyAll(TextStyle(fontWeight: FontWeight.w600)),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.pressed) || states.contains(WidgetState.hovered)) {
              return const Color(GREEN700_HEX);
            }
            return const Color(LIGHT_PRIMARY_HEX);
          }),
          foregroundColor: const WidgetStatePropertyAll(Colors.white),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          foregroundColor: const WidgetStatePropertyAll(Color(LIGHT_PRIMARY_HEX)),
          overlayColor: WidgetStatePropertyAll(const Color(LIGHT_PRIMARY_HEX).withValues(alpha: 0.08)),
        ),
      ),
      dividerColor: outline,
      textTheme: const TextTheme(
        headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(LIGHT_TEXT_HEX)),
        labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(LIGHT_SUBTEXT_HEX)),
        bodyMedium: TextStyle(fontSize: 14, color: Color(LIGHT_TEXT_HEX)),
      ),
    );
  }
}
