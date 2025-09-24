import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'api_client.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter/services.dart';
import 'features/auth/login_page.dart';
import 'features/auth/pin_page.dart';
import 'features/auth/welcome_pin_page.dart';
import 'theme/app_theme.dart';
import 'theme/theme_controller.dart';
import 'services/auth_service.dart';
import 'services/session.dart';
import 'services/device_fingerprint.dart';
import 'models/user_me.dart';
import 'features/home/home_page.dart';
import 'package:dio/dio.dart';
import 'services/secure_prefs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load env from .env (development) if present
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // Ignore missing .env
  }
  // Make status bar transparent; set a sensible default for icons in light mode
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
  ));
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});
  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final ThemeController _theme = ThemeController.I;
  Widget? _home;

  @override
  void initState() {
    super.initState();
    _theme.addListener(_onTheme);
    _bootstrap();
  }

  @override
  void dispose() {
    _theme.removeListener(_onTheme);
    super.dispose();
  }

  void _onTheme() {
    _applySystemOverlay();
    setState(() {});
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _applySystemOverlay();
  }

  void _applySystemOverlay() {
    final isLight = _theme.mode == ThemeMode.light;
    SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: isLight ? Brightness.dark : Brightness.light,
    ));
  }

  Future<void> _bootstrap() async {
    // Try restore tokens; if present keep user signed in and land on PIN gate if needed
    try {
      final auth = AuthService();
      final t = await auth.loadTokens();
      if (t != null) {
        // We have tokens, try fetch /me to restore session silently
        final dio = ApiClient.dio;
        String access = t.access;
        Future<UserMe> _fetchMe() async {
          final meResp = await dio.get('/api/auth/me/', options: Options(headers: {'Authorization': 'Bearer $access'}));
          return UserMe.fromJson((meResp.data as Map).cast<String, dynamic>());
        }
        UserMe me;
        try {
          me = await _fetchMe();
        } on DioException catch (e) {
          // Try refresh on 401
          if (e.response?.statusCode == 401) {
            final nt = await auth.refreshToken(t.refresh);
            access = nt.access;
            me = await _fetchMe();
          } else {
            rethrow;
          }
        }
  Session.I.setAuth(access: access, refresh: t.refresh, me: me);
  setState(() { _home = const HomePage(); });
        return;
      }
      // No tokens; check if we should go straight to PIN gate
      final rememberPin = await SecurePrefs.getRememberPin();
      if (rememberPin) {
        // We might not have user info in memory; fetch last stored name for greeting
        final last = await SecurePrefs.getLastUser();
        // Ensure fingerprint exists (device was registered)
        final did = await DeviceFingerprintService.getIdentity();
        if ((last != null) && (did.fingerprint.isNotEmpty)) {
          setState(() { _home = const WelcomePinPage(); });
          return;
        }
      }
    } catch (_) {}
    setState(() { _home = const LoginPage(); });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mutabaka',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightMode(), // light mode
      darkTheme: AppTheme.buildTheme(Brightness.dark), // dark mode
      themeMode: _theme.mode,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: _home ?? const SizedBox.shrink(),
    );
  }
}

/// A small gate that asks only for PIN when user has a stored session.
class LoginPinGate extends StatefulWidget {
  const LoginPinGate({super.key});
  @override
  State<LoginPinGate> createState() => _LoginPinGateState();
}

class _LoginPinGateState extends State<LoginPinGate> {
  bool _started = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start() async {
    if (_started || !mounted) return;
    _started = true;
    // Prefer session user; fallback to last stored user for greeting
    final user = Session.I.currentUser;
    String greeting;
    if (user != null && ((user.displayName.isNotEmpty) || user.username.isNotEmpty)) {
      final name = user.displayName.isNotEmpty ? user.displayName : user.username;
      greeting = 'مرحبا $name\nأدخل رمز PIN';
    } else {
      final last = await SecurePrefs.getLastUser();
      final name = (last?.$2.isNotEmpty == true) ? last!.$2 : ((last?.$1 ?? ''));
      greeting = name.isNotEmpty ? 'مرحبا $name\nأدخل رمز PIN' : 'أدخل رمز PIN';
    }
    final res = await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PinPage(args: PinPageArgs(hint: greeting))),
    );
    if (!mounted) return;
    if (res is PinResult && res.success || res == true) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomePage()));
    } else if (res is PinResult && !res.success) {
      // Edge cases: device not approved/locked -> go to Login with a message
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginPage()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(body: Center(child: CircularProgressIndicator())),
    );
  }
}

// End bootstrap helpers

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  // This widget is the home page of your application. It is stateful, meaning
  // that it has a State object (defined below) that contains fields that affect
  // how it looks.

  // This class is the configuration for the state. It holds the values (in this
  // case the title) provided by the parent (in this case the App widget) and
  // used by the build method of the State. Fields in a Widget subclass are
  // always marked "final".

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  String _status = 'Tap the button to check backend health';

  Future<void> _checkHealth() async {
    setState(() => _status = 'Checking...');
    try {
      final res = await ApiClient.dio.get('/health');
      setState(() => _status = 'Health: ${res.data}');
    } catch (e) {
      setState(() => _status = 'Error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    // This method is rerun every time setState is called, for instance as done
    // by the _incrementCounter method above.
    //
    // The Flutter framework has been optimized to make rerunning build methods
    // fast, so that you can just rebuild anything that needs updating rather
    // than having to individually change instances of widgets.
    return Scaffold(
      appBar: AppBar(
        // TRY THIS: Try changing the color here to a specific color (to
        // Colors.amber, perhaps?) and trigger a hot reload to see the AppBar
        // change color while the other colors stay the same.
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        // Here we take the value from the MyHomePage object that was created by
        // the App.build method, and use it to set our appbar title.
        title: Text(widget.title),
      ),
      body: Center(
        // Center is a layout widget. It takes a single child and positions it
        // in the middle of the parent.
        child: Column(
          // Column is also a layout widget. It takes a list of children and
          // arranges them vertically. By default, it sizes itself to fit its
          // children horizontally, and tries to be as tall as its parent.
          //
          // Column has various properties to control how it sizes itself and
          // how it positions its children. Here we use mainAxisAlignment to
          // center the children vertically; the main axis here is the vertical
          // axis because Columns are vertical (the cross axis would be
          // horizontal).
          //
          // TRY THIS: Invoke "debug painting" (choose the "Toggle Debug Paint"
          // action in the IDE, or press "p" in the console), to see the
          // wireframe for each widget.
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Text('Backend status:'),
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Text(_status, textAlign: TextAlign.center),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _checkHealth,
              icon: const Icon(Icons.health_and_safety_outlined),
              label: const Text('Check /health'),
            ),
          ],
        ),
      ),
      // This trailing comma makes auto-formatting nicer for build methods.
    );
  }
}
