import unittest

from app.risk_engine import HybridRiskEngine


class RiskEngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = HybridRiskEngine(seed=42)

    def test_severe_fault_scores_above_healthy_machine(self):
        healthy = {
            'temperature_c': 48.0,
            'temperature_rate_c_per_min': 0.03,
            'vibration_rms_velocity_mm_s': 1.9,
            'vibration_peak_acceleration_g': 0.25,
            'spindle_rpm_variation_pct': 0.7,
            'load_pct': 68,
            'motor_current_a': 7.0,
            'cycle_time_s': 92,
            'expected_cycle_time_s': 92,
            'packet_loss_pct': 0.15,
            'telemetry_latency_ms': 65,
        }
        severe = {
            'temperature_c': 88.0,
            'temperature_rate_c_per_min': 0.55,
            'vibration_rms_velocity_mm_s': 11.0,
            'vibration_peak_acceleration_g': 1.55,
            'spindle_rpm_variation_pct': 12.0,
            'load_pct': 108,
            'motor_current_a': 14.0,
            'cycle_time_s': 126,
            'expected_cycle_time_s': 92,
            'packet_loss_pct': 0.6,
            'telemetry_latency_ms': 100,
        }
        healthy_risk = self.engine.evaluate(healthy).risk_score
        severe_risk = self.engine.evaluate(severe).risk_score
        self.assertLess(healthy_risk, 0.2)
        self.assertGreater(severe_risk, 0.65)
        self.assertGreater(severe_risk, healthy_risk + 0.5)


if __name__ == '__main__':
    unittest.main()
