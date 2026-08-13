from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from .db import SupabaseRepository
from .risk_engine import HybridRiskEngine, RiskResult


@dataclass
class MachineProfile:
    machine_id: str
    machine_type: str
    display_name: str
    line_name: str
    operation: str
    rated_rpm: int
    rated_power_kw: float
    base_temp: float
    base_vibration: float
    base_current: float
    base_load: float
    expected_cycle: float
    cycle_jitter: float
    description: str = ''
    layout_x: float = 50
    layout_y: float = 50


@dataclass
class MachineRuntime:
    runtime_s: float = 0
    idle_s: float = 0
    cycle_id: int = 1
    cycle_elapsed: float = 0
    scenario: Optional[str] = None
    scenario_progress: float = 0.0
    scenario_speed: float = 0.018
    previous: Dict[str, Any] | None = None
    latest: Dict[str, Any] | None = None
    history: List[Dict[str, Any]] = field(default_factory=list)


MACHINE_PROFILES = [
    MachineProfile('LATHE-001', 'cnc_lathe', 'CNC Lathe 01', 'Machining · A', 'cutting', 1500, 4.2, 47.0, 1.8, 7.1, 67, 92, 3.2, 'Rotates stock while cutting tools shape cylindrical parts.', 18, 27),
    MachineProfile('MILL-002', 'cnc_mill', 'CNC Mill 02', 'Machining · A', 'milling', 3200, 7.5, 50.0, 2.0, 9.4, 71, 118, 5.0, 'Uses rotating cutters to machine faces, slots and precision features.', 61, 27),
    MachineProfile('PRESS-003', 'hydraulic_press', 'Hydraulic Press 03', 'Forming · B', 'forming', 980, 11.0, 43.0, 1.4, 11.5, 64, 38, 1.8, 'Applies controlled hydraulic force for forming and pressing operations.', 17, 70),
    MachineProfile('GRIND-004', 'surface_grinder', 'Surface Grinder 04', 'Finishing · C', 'grinding', 2850, 5.5, 46.0, 2.2, 7.8, 69, 74, 2.9, 'Produces precise flat finishes using an abrasive grinding wheel.', 49, 70),
    MachineProfile('PUMP-005', 'coolant_pump', 'Coolant Pump 05', 'Utilities · U1', 'circulation', 1440, 3.0, 39.0, 1.1, 4.2, 56, 60, 2.2, 'Circulates filtered coolant through the machining line.', 80, 70),
]

MACHINE_TYPE_CATALOG = {
    profile.machine_type: {
        'machine_type': profile.machine_type,
        'label': profile.machine_type.replace('_', ' ').title(),
        'description': profile.description,
        'operation': profile.operation,
        'rated_rpm': profile.rated_rpm,
        'rated_power_kw': profile.rated_power_kw,
        'base_temp': profile.base_temp,
        'base_vibration': profile.base_vibration,
        'base_current': profile.base_current,
        'base_load': profile.base_load,
        'expected_cycle': profile.expected_cycle,
        'cycle_jitter': profile.cycle_jitter,
    }
    for profile in MACHINE_PROFILES
}

SCENARIOS = {
    'bearing_fault': 'Bearing degradation',
    'overheating': 'Thermal runaway',
    'overload': 'Mechanical overload',
    'spindle_instability': 'Drive instability',
    'lubrication_loss': 'Lubrication loss',
    'sensor_degradation': 'Sensor degradation',
}


class PlantSimulator:
    def __init__(self, repository: SupabaseRepository, risk_engine: HybridRiskEngine, interval: float = 1.5) -> None:
        self.repository = repository
        self.risk_engine = risk_engine
        self.interval = interval
        self.running = False
        self.task: asyncio.Task | None = None
        self.rng = random.Random(41)
        self.profiles: Dict[str, MachineProfile] = {p.machine_id: p for p in MACHINE_PROFILES}
        self.states: Dict[str, MachineRuntime] = {p.machine_id: MachineRuntime() for p in self.profiles.values()}
        self._phase = 0.0

    async def start(self) -> None:
        seed = [
            {
                'machine_id': p.machine_id,
                'machine_type': p.machine_type,
                'display_name': p.display_name,
                'line_name': p.line_name,
                'rated_rpm': p.rated_rpm,
                'rated_power_kw': p.rated_power_kw,
                'baseline_temperature_c': p.base_temp,
                'baseline_vibration_mm_s': p.base_vibration,
                'status': 'running',
                'metadata': {
                    'operation': p.operation,
                    'description': p.description,
                    'expected_cycle_time_s': p.expected_cycle,
                    'layout_x': p.layout_x,
                    'layout_y': p.layout_y,
                },
            }
            for p in self.profiles.values()
        ]
        await self.repository.seed_machines(seed)
        if self.repository.configured:
            for row in await self.repository.list_machines():
                if row.get('machine_id') not in self.profiles and row.get('machine_type') in MACHINE_TYPE_CATALOG:
                    self._restore_profile(row)
        self.running = True
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop(), name='flowtwin-simulator')

    async def stop(self) -> None:
        self.running = False
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self.running:
            self._phase += self.interval
            # Generate/persist machines in a controlled sequence. The old
            # gather() launched several Supabase writes at the same instant,
            # which can trigger WinError 10035 on Windows.
            for profile in list(self.profiles.values()):
                await self._tick(profile)
            await asyncio.sleep(self.interval)

    def inject_failure(self, machine_id: str, scenario: str, speed: float = 0.025) -> Dict[str, Any]:
        if machine_id not in self.states:
            raise KeyError(machine_id)
        if scenario not in SCENARIOS:
            raise ValueError(scenario)
        state = self.states[machine_id]
        state.scenario = scenario
        state.scenario_progress = 0.01
        state.scenario_speed = max(0.005, min(speed, 0.08))
        return {'machine_id': machine_id, 'scenario': scenario, 'progress': state.scenario_progress}

    def clear_failure(self, machine_id: str) -> Dict[str, Any]:
        if machine_id not in self.states:
            raise KeyError(machine_id)
        state = self.states[machine_id]
        state.scenario = None
        state.scenario_progress = 0.0
        return {'machine_id': machine_id, 'scenario': None, 'progress': 0.0}

    def memory_snapshot(self) -> List[Dict[str, Any]]:
        result = []
        for p in self.profiles.values():
            s = self.states[p.machine_id]
            machine = {
                'machine_id': p.machine_id,
                'machine_type': p.machine_type,
                'display_name': p.display_name,
                'line_name': p.line_name,
                'rated_rpm': p.rated_rpm,
                'rated_power_kw': p.rated_power_kw,
                'status': self._status_from_latest(s.latest),
                'simulation_scenario': s.scenario,
                'simulation_progress': s.scenario_progress,
                'metadata': {
                    'operation': p.operation,
                    'description': p.description,
                    'expected_cycle_time_s': p.expected_cycle,
                    'layout_x': p.layout_x,
                    'layout_y': p.layout_y,
                },
            }
            result.append({'machine': machine, 'telemetry': s.latest})
        return result

    def _restore_profile(self, row: Dict[str, Any]) -> MachineProfile:
        preset = MACHINE_TYPE_CATALOG[row['machine_type']]
        metadata = row.get('metadata') or {}
        profile = MachineProfile(
            machine_id=row['machine_id'],
            machine_type=row['machine_type'],
            display_name=row.get('display_name') or row['machine_id'],
            line_name=row.get('line_name') or 'Unassigned',
            operation=metadata.get('operation') or preset['operation'],
            rated_rpm=int(row.get('rated_rpm') or preset['rated_rpm']),
            rated_power_kw=float(row.get('rated_power_kw') or preset['rated_power_kw']),
            base_temp=float(row.get('baseline_temperature_c') or preset['base_temp']),
            base_vibration=float(row.get('baseline_vibration_mm_s') or preset['base_vibration']),
            base_current=float(preset['base_current']),
            base_load=float(preset['base_load']),
            expected_cycle=float(metadata.get('expected_cycle_time_s') or preset['expected_cycle']),
            cycle_jitter=float(preset['cycle_jitter']),
            description=metadata.get('description') or preset['description'],
            layout_x=float(metadata.get('layout_x', 50)),
            layout_y=float(metadata.get('layout_y', 50)),
        )
        self.profiles[profile.machine_id] = profile
        self.states[profile.machine_id] = MachineRuntime()
        return profile

    async def add_machine(
        self,
        machine_id: str,
        machine_type: str,
        display_name: str,
        line_name: str,
        layout_x: float,
        layout_y: float,
    ) -> Dict[str, Any]:
        if machine_type not in MACHINE_TYPE_CATALOG:
            raise ValueError('Unknown machine type')
        if machine_id in self.profiles:
            raise KeyError(machine_id)
        preset = MACHINE_TYPE_CATALOG[machine_type]
        profile = MachineProfile(
            machine_id=machine_id,
            machine_type=machine_type,
            display_name=display_name,
            line_name=line_name,
            operation=preset['operation'],
            rated_rpm=preset['rated_rpm'],
            rated_power_kw=preset['rated_power_kw'],
            base_temp=preset['base_temp'],
            base_vibration=preset['base_vibration'],
            base_current=preset['base_current'],
            base_load=preset['base_load'],
            expected_cycle=preset['expected_cycle'],
            cycle_jitter=preset['cycle_jitter'],
            description=preset['description'],
            layout_x=layout_x,
            layout_y=layout_y,
        )
        self.profiles[machine_id] = profile
        self.states[machine_id] = MachineRuntime()
        await self.repository.seed_machines([{
            'machine_id': machine_id,
            'machine_type': machine_type,
            'display_name': display_name,
            'line_name': line_name,
            'rated_rpm': profile.rated_rpm,
            'rated_power_kw': profile.rated_power_kw,
            'baseline_temperature_c': profile.base_temp,
            'baseline_vibration_mm_s': profile.base_vibration,
            'status': 'running',
            'metadata': {
                'operation': profile.operation,
                'description': profile.description,
                'expected_cycle_time_s': profile.expected_cycle,
                'layout_x': layout_x,
                'layout_y': layout_y,
            },
        }])
        await self._tick(profile)
        return next(item for item in self.memory_snapshot() if item['machine']['machine_id'] == machine_id)

    async def remove_machine(self, machine_id: str) -> Dict[str, Any]:
        if machine_id not in self.profiles:
            raise KeyError(machine_id)
        del self.profiles[machine_id]
        del self.states[machine_id]
        await self.repository.delete_machine(machine_id)
        return {'machine_id': machine_id, 'removed': True}

    def memory_history(self, machine_id: str, limit: int = 120) -> List[Dict[str, Any]]:
        return self.states[machine_id].history[-limit:]

    @staticmethod
    def _healthy_baseline(history: List[Dict[str, Any]]) -> Dict[str, float] | None:
        """Build a robust machine-specific envelope from recent healthy memory."""
        samples = [row for row in history[-80:] if not row.get('simulation_scenario') and float(row.get('risk_score', 1)) < .32]
        if len(samples) < 12:
            return None
        keys = ('temperature_c', 'vibration_rms_velocity_mm_s', 'load_pct', 'cycle_time_s')
        return {key: float(np.median([float(row[key]) for row in samples if row.get(key) is not None])) for key in keys}

    @staticmethod
    def _status_from_latest(latest: Dict[str, Any] | None) -> str:
        if not latest:
            return 'running'
        level = latest.get('risk_level')
        return 'critical' if level == 'critical' else 'warning' if level in ('high', 'medium') else 'running'

    async def _tick(self, p: MachineProfile) -> None:
        s = self.states[p.machine_id]
        if s.scenario:
            s.scenario_progress = min(1.0, s.scenario_progress + s.scenario_speed)

        telemetry = self._generate(p, s)
        risk = self.risk_engine.evaluate(telemetry, s.previous, self._healthy_baseline(s.history))
        row = self._build_row(p, s, telemetry, risk)

        s.previous = telemetry.copy()
        s.latest = row
        s.history.append(row)
        if len(s.history) > 360:
            del s.history[:-300]

        try:
            await self.repository.insert_telemetry(row)
            await self.repository.update_machine(
                p.machine_id,
                {
                    'status': self._status_from_latest(row),
                    'simulation_scenario': s.scenario,
                    'simulation_progress': round(s.scenario_progress, 4),
                },
            )
            if risk.risk_level in ('high', 'critical'):
                severity = 'critical' if risk.risk_level == 'critical' else 'high'
                if not await self.repository.recent_alert_exists(p.machine_id, severity):
                    factors = ', '.join(f['name'] for f in risk.top_risk_factors[:2])
                    await self.repository.insert_alert({
                        'machine_id': p.machine_id,
                        'severity': severity,
                        'title': f"{p.display_name}: {risk.risk_level.upper()} risk",
                        'description': f"Risk reached {round(risk.risk_score * 100)}%. Leading signals: {factors}.",
                        'risk_score': risk.risk_score,
                        'source': 'hybrid_risk_engine',
                        'metadata': {
                            'simulation_scenario': s.scenario,
                            'simulation_progress': round(s.scenario_progress, 3),
                            'model_version': self.risk_engine.model_version,
                        },
                    })
        except Exception as exc:
            # Keep local simulation alive if Supabase is briefly unavailable.
            print(f'[simulator] persistence warning for {p.machine_id}: {exc}')

    def _generate(self, p: MachineProfile, s: MachineRuntime) -> Dict[str, float | int | str | bool]:
        wave = math.sin(self._phase / 18 + hash(p.machine_id) % 9) * 0.6
        pgr = s.scenario_progress
        scenario = s.scenario

        temp = p.base_temp + wave + self.rng.gauss(0, 0.35)
        temp_rate = 0.025 + self.rng.gauss(0, 0.012)
        vib = p.base_vibration + abs(self.rng.gauss(0, 0.18))
        peak = 0.21 + vib * 0.045 + abs(self.rng.gauss(0, 0.025))
        rpm_var = 0.65 + abs(self.rng.gauss(0, 0.18))
        load = p.base_load + 3.5 * math.sin(self._phase / 10 + 1.1) + self.rng.gauss(0, 1.8)
        current = p.base_current * (0.72 + load / 230) + self.rng.gauss(0, 0.18)
        cycle_multiplier = 1.0 + self.rng.gauss(0, 0.015)
        packet_loss = max(0, 0.10 + abs(self.rng.gauss(0, 0.06)))
        latency = max(20, 58 + self.rng.gauss(0, 12))

        if scenario == 'bearing_fault':
            vib += 11.0 * pgr ** 1.25
            peak += 1.55 * pgr ** 1.35
            temp += 15 * pgr
            temp_rate += 0.18 * pgr
            rpm_var += 5.5 * pgr
            cycle_multiplier += 0.08 * pgr
        elif scenario == 'overheating':
            temp += 41 * pgr ** 1.18
            temp_rate += 0.62 * pgr
            load += 8 * pgr
            current += 1.2 * pgr
            cycle_multiplier += 0.12 * pgr
        elif scenario == 'overload':
            load += 48 * pgr
            current += 7.5 * pgr
            temp += 30 * pgr ** 1.15
            temp_rate += 0.26 * pgr
            vib += 3.0 * pgr
            cycle_multiplier += 0.28 * pgr
        elif scenario == 'spindle_instability':
            rpm_var += 23 * pgr ** 1.2
            vib += 7.5 * pgr
            peak += 1.0 * pgr
            cycle_multiplier += 0.16 * pgr
        elif scenario == 'lubrication_loss':
            vib += 9.5 * pgr
            temp += 38 * pgr ** 1.2
            temp_rate += 0.4 * pgr
            current += 4.0 * pgr
            rpm_var += 8.0 * pgr
            cycle_multiplier += 0.2 * pgr
        elif scenario == 'sensor_degradation':
            packet_loss += 8.5 * pgr
            latency += 420 * pgr
            rpm_var += self.rng.random() * 4 * pgr

        load = max(15, min(load, 119))
        rpm = p.rated_rpm * (0.985 + self.rng.gauss(0, 0.004))
        if scenario == 'spindle_instability':
            rpm *= 1 + self.rng.gauss(0, 0.025 * max(pgr, 0.1))

        cycle_time = p.expected_cycle * cycle_multiplier + self.rng.gauss(0, p.cycle_jitter * 0.18)
        s.runtime_s += self.interval
        s.cycle_elapsed += self.interval
        if s.cycle_elapsed >= max(cycle_time, 1):
            s.cycle_id += 1
            s.cycle_elapsed = 0

        utilization = 100 * s.runtime_s / max(s.runtime_s + s.idle_s, 1)
        power = p.rated_power_kw * min(load / 100, 1.15) * 0.92
        confidence = 0.97 - min(packet_loss / 100, 0.3)

        return {
            'temperature_c': round(temp, 2),
            'temperature_rate_c_per_min': round(max(-0.05, temp_rate), 3),
            'vibration_rms_velocity_mm_s': round(max(0.2, vib), 3),
            'vibration_peak_acceleration_g': round(max(0.05, peak), 3),
            'vibration_dominant_frequency_hz': round(49.5 + vib * 1.3 + self.rng.gauss(0, 0.5), 2),
            'spindle_rpm': round(max(0, rpm), 1),
            'spindle_rpm_variation_pct': round(max(0.1, rpm_var), 2),
            'load_pct': round(load, 1),
            'motor_current_a': round(max(0, current), 2),
            'estimated_power_kw': round(max(0, power), 2),
            'power_estimate_confidence': round(max(0.55, confidence - 0.12), 2),
            'cycle_time_s': round(max(1, cycle_time), 2),
            'expected_cycle_time_s': p.expected_cycle,
            'packet_loss_pct': round(packet_loss, 2),
            'telemetry_latency_ms': round(latency),
            'state_confidence': round(max(0.55, confidence), 2),
            'utilization_pct': round(utilization, 2),
            'runtime_s': round(s.runtime_s),
            'idle_time_s': round(s.idle_s),
            'cycle_id': s.cycle_id,
        }

    def _build_row(self, p: MachineProfile, s: MachineRuntime, t: Dict[str, Any], r: RiskResult) -> Dict[str, Any]:
        if r.risk_level == 'critical':
            state = 'fault_risk'
        elif r.risk_level in ('high', 'medium'):
            state = 'running_degraded'
        else:
            state = 'running'

        alert = None
        if r.risk_level in ('high', 'critical'):
            alert = {
                'severity': r.risk_level,
                'message': f"{SCENARIOS.get(s.scenario, 'Abnormal operating pattern')} detected",
            }

        raw_payload = {
            'machine_id': p.machine_id,
            'machine_type': p.machine_type,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'state': state,
            'operation': p.operation,
            'state_confidence': t['state_confidence'],
            'spindle': {
                'rpm': t['spindle_rpm'],
                'rpm_source': 'simulated_external_rpm_sensor',
                'rpm_variation_pct': t['spindle_rpm_variation_pct'],
            },
            'electrical': {
                'motor_current_a': t['motor_current_a'],
                'load_pct': t['load_pct'],
                'estimated_power_kw': t['estimated_power_kw'],
                'power_estimation_method': 'current_model',
                'power_estimate_confidence': t['power_estimate_confidence'],
            },
            'thermal': {
                'temperature_c': t['temperature_c'],
                'sensor_location': 'drive_housing',
                'temperature_rate_c_per_min': t['temperature_rate_c_per_min'],
            },
            'vibration': {
                'rms_velocity_mm_s': t['vibration_rms_velocity_mm_s'],
                'peak_acceleration_g': t['vibration_peak_acceleration_g'],
                'dominant_frequency_hz': t['vibration_dominant_frequency_hz'],
                'sensor_location': 'front_bearing_housing',
                'axis': 'radial_x',
                'sampling_rate_hz': 6400,
            },
            'production': {
                'cycle_id': t['cycle_id'],
                'cycle_count_type': 'detected',
                'cycle_time_s': t['cycle_time_s'],
                'part_count_verified': False,
            },
            'utilization': {
                'runtime_s': t['runtime_s'],
                'idle_time_s': t['idle_time_s'],
                'utilization_pct': t['utilization_pct'],
            },
            'data_quality': {
                'sensor_health': 'degraded' if t['packet_loss_pct'] >= 3 else 'good',
                'packet_loss_pct': t['packet_loss_pct'],
                'telemetry_latency_ms': t['telemetry_latency_ms'],
            },
            'analytics': {
                'anomaly_score': r.anomaly_score,
                'ml_failure_probability': r.ml_failure_probability,
                'physics_risk': r.physics_risk,
                'trend_risk': r.trend_risk,
                'risk_score': r.risk_score,
                'health_score': r.health_score,
                'risk_level': r.risk_level,
                'model_version': self.risk_engine.model_version,
                'top_risk_factors': r.top_risk_factors,
            },
            'simulation': {'scenario': s.scenario, 'progress': round(s.scenario_progress, 4)},
            'alert': alert,
        }

        return {
            'machine_id': p.machine_id,
            'machine_type': p.machine_type,
            'recorded_at': raw_payload['timestamp'],
            'state': state,
            'operation': p.operation,
            'state_confidence': t['state_confidence'],
            'spindle_rpm': t['spindle_rpm'],
            'spindle_rpm_source': 'simulated_external_rpm_sensor',
            'spindle_rpm_variation_pct': t['spindle_rpm_variation_pct'],
            'motor_current_a': t['motor_current_a'],
            'load_pct': t['load_pct'],
            'estimated_power_kw': t['estimated_power_kw'],
            'power_estimation_method': 'current_model',
            'power_estimate_confidence': t['power_estimate_confidence'],
            'temperature_c': t['temperature_c'],
            'thermal_sensor_location': 'drive_housing',
            'temperature_rate_c_per_min': t['temperature_rate_c_per_min'],
            'vibration_rms_velocity_mm_s': t['vibration_rms_velocity_mm_s'],
            'vibration_peak_acceleration_g': t['vibration_peak_acceleration_g'],
            'vibration_dominant_frequency_hz': t['vibration_dominant_frequency_hz'],
            'vibration_sensor_location': 'front_bearing_housing',
            'vibration_axis': 'radial_x',
            'vibration_sampling_rate_hz': 6400,
            'cycle_id': t['cycle_id'],
            'cycle_count_type': 'detected',
            'cycle_time_s': t['cycle_time_s'],
            'part_count_verified': False,
            'runtime_s': t['runtime_s'],
            'idle_time_s': t['idle_time_s'],
            'utilization_pct': t['utilization_pct'],
            'sensor_health': 'degraded' if t['packet_loss_pct'] >= 3 else 'good',
            'packet_loss_pct': t['packet_loss_pct'],
            'telemetry_latency_ms': t['telemetry_latency_ms'],
            'anomaly_score': r.anomaly_score,
            'ml_failure_probability': r.ml_failure_probability,
            'physics_risk': r.physics_risk,
            'trend_risk': r.trend_risk,
            'risk_score': r.risk_score,
            'health_score': r.health_score,
            'risk_level': r.risk_level,
            'model_version': self.risk_engine.model_version,
            'top_risk_factors': r.top_risk_factors,
            'simulation_scenario': s.scenario,
            'simulation_progress': round(s.scenario_progress, 4),
            'alert': alert,
            'raw_payload': raw_payload,
        }
