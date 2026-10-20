import 'package:flutter_test/flutter_test.dart';
import 'package:four_wd_controller/robot_client.dart';

void main() {
  test('status parses the robot state', () {
    final status = RobotStatus.fromJson({
      'ready': true, 'mode': 'auto', 'motion': 'forward',
      'phase': 'drive', 'phaseRemainingMs': 1900, 'servoEnabled': true,
    });
    expect(status.ready, isTrue);
    expect(status.mode, 'auto');
    expect(status.phaseRemainingMs, 1900);
    expect(status.servoEnabled, isTrue);
  });
  test('missing status fields default safely', () {
    final status = RobotStatus.fromJson({});
    expect(status.ready, isFalse);
    expect(status.motion, 'stop');
    expect(status.mode, 'manual');
  });
}
