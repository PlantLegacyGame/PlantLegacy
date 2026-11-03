import { type ConfigFile, readNumber } from '@plant-legacy/shared/config';

export interface WorldConfig {
  tickRateHz: number;
  maxPlayersPerWorld: number;
  reconnectWindowMin: number;
  offlineDamageMultiplier: number;
  detailedPlantBudget: number;
  cellSize: number;
  interestRingRadius: number;
  perClientEntityCap: number;
  snapshotIntervalTicks: number;
  eventLogCompactionThreshold: number;
  activeTickRateHz: number;
  nearTickRateHz: number;
  dormantStepIntervalSec: number;
  tickBudgetActiveShare: number;
  tickBudgetWarnThresholdMs: number;
}

export function loadWorldConfig(configs: Map<string, ConfigFile>): WorldConfig {
  return {
    tickRateHz: readNumber(configs, 'world', 'tick_rate_hz'),
    maxPlayersPerWorld: readNumber(configs, 'world', 'max_players_per_world'),
    reconnectWindowMin: readNumber(configs, 'world', 'reconnect_window_min'),
    offlineDamageMultiplier: readNumber(configs, 'world', 'offline_damage_multiplier'),
    detailedPlantBudget: readNumber(configs, 'world', 'detailed_plant_budget'),
    cellSize: readNumber(configs, 'world', 'cell_size'),
    interestRingRadius: readNumber(configs, 'world', 'interest_ring_radius'),
    perClientEntityCap: readNumber(configs, 'world', 'per_client_entity_cap'),
    snapshotIntervalTicks: readNumber(configs, 'world', 'snapshot_interval_ticks'),
    eventLogCompactionThreshold: readNumber(configs, 'world', 'event_log_compaction_threshold'),
    activeTickRateHz: readNumber(configs, 'world', 'active_tick_rate_hz'),
    nearTickRateHz: readNumber(configs, 'world', 'near_tick_rate_hz'),
    dormantStepIntervalSec: readNumber(configs, 'world', 'dormant_step_interval_sec'),
    tickBudgetActiveShare: readNumber(configs, 'world', 'tick_budget_active_share'),
    tickBudgetWarnThresholdMs: readNumber(configs, 'world', 'tick_budget_warn_threshold_ms'),
  };
}
