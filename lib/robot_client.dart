import 'dart:async';
import 'dart:convert';
import 'dart:io';

class RobotStatus {
  final bool ready;
  final String mode;
  final String motion;
  final String phase;
  final int phaseRemainingMs;
  final bool servoEnabled;
  const RobotStatus({
    required this.ready, required this.mode, required this.motion,
    required this.phase, required this.phaseRemainingMs,
    required this.servoEnabled,
  });
  factory RobotStatus.fromJson(Map<String, dynamic> json) => RobotStatus(
    ready: json['ready'] == true,
    mode: json['mode']?.toString() ?? 'manual',
    motion: json['motion']?.toString() ?? 'stop',
    phase: json['phase']?.toString() ?? 'idle',
    phaseRemainingMs: (json['phaseRemainingMs'] as num?)?.toInt() ?? 0,
    servoEnabled: json['servoEnabled'] == true,
  );
}

class RobotClient {
  RobotClient({this.host = '192.168.4.1'});
  final String host;
  Future<Map<String, dynamic>> request(String path) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client.getUrl(Uri.parse('http://$host$path'));
      request.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
      final response = await request.close().timeout(const Duration(seconds: 2));
      final body = await utf8.decoder.bind(response).join().timeout(const Duration(seconds: 2));
      if (response.statusCode != 200) {
        throw HttpException('Robot responded with HTTP ${response.statusCode}');
      }
      if (body.isEmpty || body == 'OK') return {};
      return jsonDecode(body) as Map<String, dynamic>;
    } finally {
      client.close(force: true);
    }
  }

  Future<RobotStatus> status() async => RobotStatus.fromJson(await request('/status'));
  Future<void> drive(String direction) async => request('/$direction');
  Future<void> stop() async => request('/stop');
  Future<void> heartbeat() async => request('/heartbeat');
  Future<void> autopilot(String preset) async =>
      request('/auto?mode=${Uri.encodeQueryComponent(preset)}');
  Future<void> gate(bool open, {int channel = 1}) async =>
      request('/servo?channel=$channel&gate=${open ? 'open' : 'close'}');
}
