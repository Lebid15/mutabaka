import 'dart:async';

import 'package:flutter/foundation.dart';
import '../../services/auth_service.dart';
import '../../services/device_fingerprint.dart';

enum LoginState { idle, loading, success, error }

class LoginController extends ChangeNotifier {
  LoginState state = LoginState.idle;
  String? errorMessage;
  bool otpRequired = false;
  bool pinRequired = false;
  String? generatedPinOnce;

  bool get isIdle => state == LoginState.idle;
  bool get isLoading => state == LoginState.loading;
  bool get isSuccess => state == LoginState.success;
  bool get isError => state == LoginState.error;

  Future<void> login({
    required String identifier,
    required String password,
    required bool rememberMe,
    String? otp,
  }) async {
    errorMessage = null;
    otpRequired = false;
    state = LoginState.loading;
    notifyListeners();
    try {
      final service = AuthService();
      final did = await DeviceFingerprintService.getIdentity();
      final res = await service.login(
        identifier: identifier,
        password: password,
        otp: otp,
        remember: rememberMe,
        fingerprint: did.fingerprint,
        deviceName: did.name,
        platform: did.platform,
      );
      generatedPinOnce = res.showGeneratedPinOnce;
      pinRequired = res.requiresPin;
      state = LoginState.success;
    } on OtpRequiredError catch (e) {
      otpRequired = true;
      state = LoginState.error;
      errorMessage = e.message;
    } catch (e) {
      state = LoginState.error;
      errorMessage = e.toString().replaceFirst('Exception: ', '');
    }
    notifyListeners();
  }

  void reset() {
    state = LoginState.idle;
    errorMessage = null;
    otpRequired = false;
    pinRequired = false;
    generatedPinOnce = null;
    notifyListeners();
  }
}
