from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler


FEATURE_NAMES = [
    'temperature_c',
    'temperature_rate_c_per_min',
    'vibration_rms_velocity_mm_s',
    'peak_acceleration_g',
    'rpm_variation_pct',
    'load_pct',
    'motor_current_a',
    'cycle_time_ratio',
    'packet_loss_pct',
    'telemetry_latency_ms',
]


@dataclass
class RiskResult:
    ml_failure_probability: float
    anomaly_score: float
    physics_risk: float
    trend_risk: float
    risk_score: float
    health_score: float
    risk_level: str
    top_risk_factors: List[Dict[str, float | str]]


class HybridRiskEngine:
    """Simulation-calibrated predictive-maintenance engine.

    Two ML models are trained deterministically on synthetic degradation trajectories:
    a GradientBoostingClassifier for failure probability and IsolationForest for novelty.
    Their outputs are fused with normalized physics limits and short-horizon trend risk.

    Replace synthetic training data with real labelled plant history before production use.
    """

    model_version = 'flowtwin-hybrid-v2.1-contextual'

    def __init__(self, seed: int = 42) -> None:
        self.rng = np.random.default_rng(seed)
        x, y = self._training_data(9000)
        self.scaler = StandardScaler().fit(x)
        xs = self.scaler.transform(x)

        self.classifier = GradientBoostingClassifier(
            n_estimators=130,
            learning_rate=0.055,
            max_depth=3,
            subsample=0.88,
            random_state=seed,
        ).fit(xs, y)

        normal = xs[y == 0]
        self.anomaly = IsolationForest(
            n_estimators=180,
            contamination=0.08,
            random_state=seed,
            n_jobs=-1,
        ).fit(normal)

    def _training_data(self, n: int) -> Tuple[np.ndarray, np.ndarray]:
        severity = self.rng.beta(1.35, 3.2, n)
        latent_fault = self.rng.choice([0, 1, 2, 3, 4], n, p=[0.66, 0.10, 0.09, 0.08, 0.07])

        temp = 42 + 32 * severity + self.rng.normal(0, 2.4, n)
        temp_rate = 0.01 + 0.55 * severity + self.rng.normal(0, 0.035, n)
        vib = 1.25 + 8.2 * severity + self.rng.normal(0, 0.55, n)
        peak = 0.16 + 1.6 * severity + self.rng.normal(0, 0.08, n)
        rpm_var = 0.45 + 12 * severity + self.rng.normal(0, 0.8, n)
        load = 58 + 47 * severity + self.rng.normal(0, 4.5, n)
        current = 5.4 + 8.0 * severity + self.rng.normal(0, 0.65, n)
        cycle_ratio = 0.98 + 0.52 * severity + self.rng.normal(0, 0.035, n)
        packet = 0.08 + 3.0 * severity + self.rng.normal(0, 0.18, n)
        latency = 56 + 250 * severity + self.rng.normal(0, 20, n)

        # Fault-specific signatures force the learner to use multivariate patterns.
        temp += (latent_fault == 2) * (8 + 18 * severity)
        temp_rate += (latent_fault == 2) * (0.12 + 0.3 * severity)
        vib += (latent_fault == 1) * (2.5 + 5 * severity)
        peak += (latent_fault == 1) * (0.35 + 0.65 * severity)
        load += (latent_fault == 3) * (12 + 20 * severity)
        current += (latent_fault == 3) * (1.5 + 4 * severity)
        rpm_var += (latent_fault == 4) * (3 + 9 * severity)

        x = np.column_stack([
            temp,
            temp_rate,
            vib,
            peak,
            rpm_var,
            load,
            current,
            cycle_ratio,
            packet,
            latency,
        ])

        latent_score = (
            0.22 * np.clip((temp - 58) / 30, 0, 1.5)
            + 0.20 * np.clip((vib - 3.0) / 7.0, 0, 1.5)
            + 0.13 * np.clip((peak - 0.35) / 1.2, 0, 1.5)
            + 0.12 * np.clip((rpm_var - 2.5) / 10, 0, 1.5)
            + 0.12 * np.clip((load - 78) / 35, 0, 1.5)
            + 0.08 * np.clip((cycle_ratio - 1.05) / 0.5, 0, 1.5)
            + 0.08 * np.clip((temp_rate - 0.08) / 0.55, 0, 1.5)
            + 0.05 * np.clip((latency - 130) / 240, 0, 1.5)
        )
        probability = 1 / (1 + np.exp(-10 * (latent_score - 0.56)))
        y = (self.rng.random(n) < probability).astype(int)
        return x, y

    @staticmethod
    def _clip01(v: float) -> float:
        return float(np.clip(v, 0.0, 1.0))

    def evaluate(self, telemetry: Dict, previous: Dict | None = None, baseline: Dict | None = None) -> RiskResult:
        cycle_ref = max(float(telemetry.get('expected_cycle_time_s', 90.0)), 1.0)
        cycle_ratio = float(telemetry['cycle_time_s']) / cycle_ref

        vector = np.array([[
            telemetry['temperature_c'],
            telemetry['temperature_rate_c_per_min'],
            telemetry['vibration_rms_velocity_mm_s'],
            telemetry['vibration_peak_acceleration_g'],
            telemetry['spindle_rpm_variation_pct'],
            telemetry['load_pct'],
            telemetry['motor_current_a'],
            cycle_ratio,
            telemetry['packet_loss_pct'],
            telemetry['telemetry_latency_ms'],
        ]], dtype=float)

        scaled = self.scaler.transform(vector)
        ml_probability = float(self.classifier.predict_proba(scaled)[0, 1])

        # IsolationForest decision_function: positive=inlier. Convert to bounded risk.
        novelty = -float(self.anomaly.decision_function(scaled)[0])
        anomaly_score = self._clip01(0.5 + novelty * 2.2)

        factors = {
            'Temperature': self._clip01((telemetry['temperature_c'] - 55) / 30),
            'Thermal rise': self._clip01((telemetry['temperature_rate_c_per_min'] - 0.06) / 0.48),
            'Vibration': self._clip01((telemetry['vibration_rms_velocity_mm_s'] - 2.5) / 6.5),
            'Peak acceleration': self._clip01((telemetry['vibration_peak_acceleration_g'] - 0.3) / 1.1),
            'RPM instability': self._clip01((telemetry['spindle_rpm_variation_pct'] - 1.8) / 9.5),
            'Mechanical load': self._clip01((telemetry['load_pct'] - 75) / 30),
            'Cycle slowdown': self._clip01((cycle_ratio - 1.05) / 0.42),
            'Data quality': self._clip01(max((telemetry['packet_loss_pct'] - 0.8) / 5, (telemetry['telemetry_latency_ms'] - 120) / 300)),
        }

        # Plant memory calibration: compare each signal with this machine's own
        # healthy operating envelope. This prevents a lightly-loaded pump and a
        # high-throughput mill from being judged by the same static thresholds.
        if baseline:
            baseline_vibration = max(float(baseline.get('vibration_rms_velocity_mm_s', 0)), .25)
            baseline_temperature = float(baseline.get('temperature_c', telemetry['temperature_c']))
            baseline_load = float(baseline.get('load_pct', telemetry['load_pct']))
            baseline_cycle = max(float(baseline.get('cycle_time_s', telemetry['cycle_time_s'])), 1.0)
            contextual = {
                'Temperature deviation': self._clip01((telemetry['temperature_c'] - baseline_temperature - 3.0) / 15.0),
                'Vibration deviation': self._clip01((telemetry['vibration_rms_velocity_mm_s'] - baseline_vibration * 1.2) / max(baseline_vibration * 1.8, 1.4)),
                'Load deviation': self._clip01((telemetry['load_pct'] - baseline_load - 8.0) / 25.0),
                'Cycle deviation': self._clip01((telemetry['cycle_time_s'] / baseline_cycle - 1.05) / .28),
            }
            contextual_risk = sum(contextual.values()) / len(contextual)
            factors.update(contextual)
        else:
            contextual_risk = 0.0

        physics_risk = self._clip01(
            0.22 * factors['Temperature']
            + 0.12 * factors['Thermal rise']
            + 0.22 * factors['Vibration']
            + 0.10 * factors['Peak acceleration']
            + 0.11 * factors['RPM instability']
            + 0.11 * factors['Mechanical load']
            + 0.08 * factors['Cycle slowdown']
            + 0.04 * factors['Data quality']
        )

        if previous:
            temp_delta = max(0.0, telemetry['temperature_c'] - previous.get('temperature_c', telemetry['temperature_c']))
            vib_delta = max(0.0, telemetry['vibration_rms_velocity_mm_s'] - previous.get('vibration_rms_velocity_mm_s', telemetry['vibration_rms_velocity_mm_s']))
            load_delta = max(0.0, telemetry['load_pct'] - previous.get('load_pct', telemetry['load_pct']))
            trend_risk = self._clip01(0.45 * temp_delta / 2.5 + 0.4 * vib_delta / 0.8 + 0.15 * load_delta / 10)
        else:
            trend_risk = 0.0

        # Hybrid custom fusion. The interaction bonus escalates when independent signals agree.
        agreement_bonus = 0.10 * min(ml_probability, physics_risk) + 0.05 * min(anomaly_score, physics_risk)
        risk = self._clip01(
            0.47 * ml_probability
            + 0.20 * anomaly_score
            + 0.25 * physics_risk
            + 0.08 * trend_risk
            + 0.08 * contextual_risk
            + agreement_bonus
        )

        health = round(100 * (1 - risk ** 1.12), 1)
        if risk >= 0.72:
            level = 'critical'
        elif risk >= 0.52:
            level = 'high'
        elif risk >= 0.32:
            level = 'medium'
        else:
            level = 'low'

        sorted_factors = sorted(factors.items(), key=lambda kv: kv[1], reverse=True)[:4]
        top = [
            {'name': name, 'contribution': round(value, 3), 'percent': round(value * 100, 1)}
            for name, value in sorted_factors
        ]

        return RiskResult(
            ml_failure_probability=round(ml_probability, 4),
            anomaly_score=round(anomaly_score, 4),
            physics_risk=round(physics_risk, 4),
            trend_risk=round(trend_risk, 4),
            risk_score=round(risk, 4),
            health_score=health,
            risk_level=level,
            top_risk_factors=top,
        )
