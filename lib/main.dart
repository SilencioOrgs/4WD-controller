import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'robot_client.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight,
  ]);
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const ControllerApp());
}

class ControllerApp extends StatelessWidget {
  const ControllerApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title: '4WD / FIELD CONTROLLER', debugShowCheckedModeBanner: false,
    theme: ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xFF0D0F12),
      colorScheme: const ColorScheme.dark(primary: Color(0xFFE1E4E7)),
      fontFamily: 'Roboto', useMaterial3: true,
    ),
    home: const ControlScreen(),
  );
}

class ControlScreen extends StatefulWidget {
  const ControlScreen({super.key});
  @override State<ControlScreen> createState() => _ControlScreenState();
}

class _ControlScreenState extends State<ControlScreen> with WidgetsBindingObserver {
  final RobotClient robot = RobotClient();
  Timer? poller, holdRepeater, beat;
  RobotStatus? status;
  bool connected = false, haptic = true, busy = false;
  bool settings = false, secondServo = false;
  String selected = 'manual', activeDirection = 'stop', preset = 'plant';
  int failures = 0;

  @override void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll();
    poller = Timer.periodic(const Duration(seconds: 2), (_) => _poll());
    beat = Timer.periodic(const Duration(milliseconds: 350), (_) {
      if (connected && (selected != 'manual' || activeDirection != 'stop')) {
        robot.heartbeat().catchError((Object _) {
          if (mounted) setState(() => connected = false);
        });
      }
    });
  }

  @override void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    poller?.cancel(); holdRepeater?.cancel(); beat?.cancel();
    robot.stop().catchError((Object _) {});
    super.dispose();
  }

  @override void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      _release();
      robot.stop().catchError((Object _) {});
    } else { _poll(); }
  }

  Future<void> _poll() async {
    if (busy) return;
    try {
      final s = await robot.status();
      if (!mounted) return;
      setState(() {
        status = s; connected = s.ready; failures = 0;
        if (s.ready) selected = s.mode;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() { failures++; connected = false; status = null; });
    }
  }

  void _feedback() { if (haptic) HapticFeedback.selectionClick(); }

  void _press(String direction) {
    if (!connected || selected != 'manual') return;
    _feedback();
    holdRepeater?.cancel();
    setState(() => activeDirection = direction);
    robot.drive(direction).catchError((Object _) => _lost());
    holdRepeater = Timer.periodic(const Duration(milliseconds: 250), (_) {
      robot.drive(direction).catchError((Object _) => _lost());
    });
  }

  void _release() {
    holdRepeater?.cancel(); holdRepeater = null;
    if (activeDirection != 'stop') {
      activeDirection = 'stop';
      if (mounted) setState(() {});
      robot.stop().catchError((Object _) {});
    }
  }

  void _lost() {
    if (!mounted) return;
    _release();
    setState(() { connected = false; status = null; });
  }

  Future<void> _mode(String mode) async {
    _release();
    if (!connected) return;
    _feedback();
    setState(() => busy = true);
    try {
      if (mode == 'manual') {
        await robot.stop();
      } else {
        await robot.autopilot(preset);
      }
      if (mounted) setState(() => selected = mode);
      await _poll();
    } catch (_) { _lost(); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> _gate(bool open, {int channel = 1}) async {
    if (!connected || selected != 'manual') return;
    _feedback();
    try { await robot.gate(open, channel: channel); }
    catch (_) { _lost(); }
  }

  Future<void> _stop() async {
    _release(); _feedback();
    try { await robot.stop(); await _poll(); }
    catch (_) { _lost(); }
    if (mounted) setState(() => selected = 'manual');
  }

  @override Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final compact = w < 700;
    return Scaffold(
      body: SafeArea(child: Padding(
        padding: EdgeInsets.all(compact ? 9 : 16),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFF191B20),
            borderRadius: BorderRadius.circular(90),
            border: Border.all(color: const Color(0xFF54575F), width: 2),
            boxShadow: const [BoxShadow(color: Colors.black54, blurRadius: 20, offset: Offset(0, 12))],
          ),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: compact ? 17 : 28, vertical: compact ? 12 : 20),
            child: Column(children: [
              Row(children: [
                const Icon(Icons.sports_esports_outlined, color: Color(0xFFBDC2C8), size: 22),
                const SizedBox(width: 8),
                const Text('4WD / FIELD UNIT', style: TextStyle(letterSpacing: 2, fontWeight: FontWeight.w700, fontSize: 11)),
                const Spacer(),
                Icon(connected ? Icons.wifi_rounded : Icons.wifi_off_rounded,
                  size: 16, color: connected ? const Color(0xFFB8CFBC) : const Color(0xFFE6A49B)),
                const SizedBox(width: 6),
                Text(connected ? 'BOARD CONNECTED' : 'NOT CONNECTED',
                  style: TextStyle(fontSize: 10, letterSpacing: 1, color: connected ? const Color(0xFFB8CFBC) : const Color(0xFFE6A49B))),
                const SizedBox(width: 14),
                InkWell(onTap: () => setState(() => settings = !settings),
                  child: const Icon(Icons.tune_rounded, size: 20)),
              ]),
              const SizedBox(height: 9),
              Expanded(child: Row(children: [
                Expanded(flex: 3, child: Center(child: AspectRatio(
                  aspectRatio: 1, child: _Dpad(
                    enabled: connected && selected == 'manual',
                    onDown: _press, onUp: _release,
                  ),
                ))),
                const SizedBox(width: 12),
                Expanded(flex: 5, child: _display(compact)),
                const SizedBox(width: 12),
                Expanded(flex: 3, child: _actions()),
              ])),
              const SizedBox(height: 9),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.circle, size: 5, color: Color(0xFF8B8E96)),
                const SizedBox(width: 6),
                Text('LOCAL CONTROL  /  192.168.4.1', style: TextStyle(fontSize: compact ? 8 : 10,
                    letterSpacing: 1.1, color: const Color(0xFF838992))),
              ]),
            ]),
          ),
        ),
      )),
    );
  }

  Widget _display(bool compact) {
    final phase = status?.phase ?? 'idle';
    return Container(
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        color: const Color(0xFF0B0E12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF373B44)),
      ),
      child: settings ? _settings() : !connected ? _offline() : Column(
        crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Text('CONTROL SYSTEM', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.6)),
            const Spacer(),
            Text(selected == 'manual' ? 'MANUAL' : 'AUTOPILOT', style: const TextStyle(fontSize: 10, color: Color(0xFFABB2BD))),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: _modeButton('MANUAL', 'manual')),
            const SizedBox(width: 8),
            Expanded(child: _modeButton('AUTO', 'auto')),
          ]),
          const SizedBox(height: 10),
          if (selected == 'auto') ...[
            Row(children: [
              Expanded(child: _preset('PLANT CYCLE', 'plant')),
              const SizedBox(width: 6),
              Expanded(child: _preset('CRUISE', 'cruise')),
              const SizedBox(width: 6),
              Expanded(child: _preset('PULSE', 'pulse')),
            ]),
            const SizedBox(height: 8),
            Text('STATE: ${phase.toUpperCase()}   •   ${(status!.phaseRemainingMs / 1000).toStringAsFixed(1)}s',
              style: const TextStyle(fontSize: 10, color: Color(0xFFA6B0BC))),
            const SizedBox(height: 5),
            const Text('PLANT: 3s forward / gate closed, 3s stopped / gate open',
              maxLines: 2, style: TextStyle(fontSize: 10, color: Color(0xFF868E99))),
          ] else ...[
            const Text('HOLD D-PAD TO DRIVE', style: TextStyle(fontSize: 10, letterSpacing: 1.1, color: Color(0xFFAEB4BC))),
            const SizedBox(height: 5),
            const Text('RELEASE TO STOP. A / B CONTROLS GATE 1.',
              style: TextStyle(fontSize: 9, color: Color(0xFF848B95))),
            if (secondServo) const Text('X / Y CONTROLS GATE 2.',
              style: TextStyle(fontSize: 9, color: Color(0xFF848B95))),
          ],
          const Spacer(),
          SizedBox(height: 35, child: FilledButton.tonalIcon(
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF3B2425), foregroundColor: const Color(0xFFF5CFCC),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7)),
            ),
            onPressed: _stop,
            icon: const Icon(Icons.stop_rounded, size: 18),
            label: const Text('EMERGENCY STOP', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
          )),
        ],
      ),
    );
  }

  Widget _modeButton(String label, String value) => OutlinedButton(
    onPressed: busy ? null : () => _mode(value),
    style: OutlinedButton.styleFrom(
      padding: EdgeInsets.zero,
      backgroundColor: selected == value ? const Color(0xFFD1D5DA) : const Color(0xFF1A1E24),
      foregroundColor: selected == value ? const Color(0xFF15181C) : const Color(0xFFE3E5E8),
      side: const BorderSide(color: Color(0xFF6C727C)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    child: Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1)),
  );

  Widget _preset(String text, String value) => InkWell(
    onTap: () async {
      if (!connected) return;
      _feedback();
      setState(() => preset = value);
      if (selected == 'auto') await _mode('auto');
    },
    child: Container(padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: preset == value ? const Color(0xFF454A54) : const Color(0xFF1C2026),
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: preset == value ? const Color(0xFFE0E2E5) : const Color(0xFF3C414A)),
      ),
      alignment: Alignment.center,
      child: Text(text, style: const TextStyle(fontSize: 8, fontWeight: FontWeight.bold)),
    ),
  );

  Widget _offline() => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
    const Icon(Icons.wifi_off_outlined, color: Color(0xFFABB2BC), size: 36),
    const SizedBox(height: 12),
    const Text('ROBOT NOT CONNECTED', style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2, fontSize: 12)),
    const SizedBox(height: 8),
    const Text('Connect your phone to Wi-Fi:\nESP32-CAM Robot\nThen return here and retry.',
      textAlign: TextAlign.center, style: TextStyle(color: Color(0xFFA8AFB8), fontSize: 11)),
    const SizedBox(height: 9),
    OutlinedButton.icon(onPressed: _poll, icon: const Icon(Icons.refresh, size: 16), label: const Text('RETRY')),
  ]);

  Widget _settings() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    Row(children: [
      const Text('SETTINGS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
      const Spacer(),
      IconButton(onPressed: () => setState(() => settings = false), icon: const Icon(Icons.close, size: 18)),
    ]),
    Expanded(child: ListView(children: [
      SwitchListTile.adaptive(title: const Text('Haptic feedback', style: TextStyle(fontSize: 12)),
        subtitle: const Text('Vibrate on button press', style: TextStyle(fontSize: 10)),
        value: haptic, onChanged: (v) => setState(() => haptic = v), dense: true),
      SwitchListTile.adaptive(title: const Text('Show servo 2', style: TextStyle(fontSize: 12)),
        subtitle: const Text('Requires GPIO4 wiring and matching firmware', style: TextStyle(fontSize: 10)),
        value: secondServo, onChanged: (v) => setState(() => secondServo = v), dense: true),
      const ListTile(dense: true, title: Text('ROBOT ACCESS POINT', style: TextStyle(fontSize: 10)),
        subtitle: Text('ESP32-CAM Robot • 192.168.4.1', style: TextStyle(fontSize: 11))),
    ])),
  ]);

  Widget _actions() => Column(mainAxisAlignment: MainAxisAlignment.center, children: [
    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      _round('Y', () => _gate(true, channel: 2), enabled: secondServo && selected == 'manual' && connected),
    ]),
    Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
      _round('X', () => _gate(false, channel: 2), enabled: secondServo && selected == 'manual' && connected),
      _round('B', () => _gate(false), enabled: selected == 'manual' && connected),
    ]),
    Row(mainAxisAlignment: MainAxisAlignment.center, children: [
      _round('A', () => _gate(true), enabled: selected == 'manual' && connected),
    ]),
    const SizedBox(height: 12),
    const Text('A OPEN   B CLOSE', style: TextStyle(color: Color(0xFF868D96), fontSize: 9)),
  ]);

  Widget _round(String label, VoidCallback onTap, {required bool enabled}) =>
    Padding(padding: const EdgeInsets.all(3),
      child: Opacity(opacity: enabled ? 1 : 0.4,
        child: Material(color: const Color(0xFF343941), shape: const CircleBorder(),
          child: InkWell(customBorder: const CircleBorder(), onTap: enabled ? () { _feedback(); onTap(); } : null,
            child: SizedBox(width: 48, height: 48,
              child: Center(child: Text(label, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold)))))),
      ));
}

class _Dpad extends StatelessWidget {
  const _Dpad({required this.enabled, required this.onDown, required this.onUp});
  final bool enabled;
  final void Function(String) onDown;
  final VoidCallback onUp;
  @override Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
    final side = constraints.biggest.shortestSide;
    final cell = side / 3;
    return Center(child: SizedBox(width: side, height: side,
      child: Stack(children: [
        Positioned(left: cell, top: 0, width: cell, height: cell, child: _key(Icons.keyboard_arrow_up, 'go')),
        Positioned(left: 0, top: cell, width: cell, height: cell, child: _key(Icons.keyboard_arrow_left, 'left')),
        Positioned(left: cell, top: cell, width: cell, height: cell,
          child: Container(decoration: BoxDecoration(color: const Color(0xFF292D34), borderRadius: BorderRadius.circular(8)),
            child: const Icon(Icons.control_camera, color: Color(0xFF616771), size: 19))),
        Positioned(left: cell * 2, top: cell, width: cell, height: cell, child: _key(Icons.keyboard_arrow_right, 'right')),
        Positioned(left: cell, top: cell * 2, width: cell, height: cell, child: _key(Icons.keyboard_arrow_down, 'back')),
      ]),
    )));
  });
  Widget _key(IconData icon, String direction) => Listener(
    onPointerDown: enabled ? (_) => onDown(direction) : null,
    onPointerUp: enabled ? (_) => onUp() : null,
    onPointerCancel: enabled ? (_) => onUp() : null,
    child: Container(
      decoration: BoxDecoration(
        color: const Color(0xFF3B4048), borderRadius: BorderRadius.circular(9),
        border: Border.all(color: const Color(0xFF626873)),
      ),
      child: Icon(icon, size: 30, color: enabled ? const Color(0xFFE5E7EA) : const Color(0xFF757C86)),
    ),
  );
}
