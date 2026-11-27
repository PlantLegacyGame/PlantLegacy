import type { ConfigFile } from '@plant-legacy/shared/config';
import { readInteger, readNumber } from '@plant-legacy/shared/config';

export interface ChatConfig {
  proximityRangePx: number;
  worldRateMsgPerMin: number;
  logSize: number;
  messageMaxChars: number;
  /** Largest per-connection block list; new ids are refused at the cap. */
  blockListMax: number;
  emoteIds: string[];
}

export interface ReportConfig {
  reportRateLimitPerMin: number;
  reportFreeTextMax: number;
  contextLineCount: number;
  /** Reports are held in memory only; cap the list so it cannot grow forever. */
  maxStoredReports: number;
}

export function loadChatConfig(configs: Map<string, ConfigFile>): ChatConfig {
  const emoteEntry = configs.get('emotes')?.values.emote_definitions;
  const emoteIds: string[] = [];
  if (emoteEntry && Array.isArray(emoteEntry.value)) {
    for (const item of emoteEntry.value) {
      if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
        emoteIds.push((item as { id: string }).id.toLowerCase());
      }
    }
  }

  return {
    proximityRangePx: readNumber(configs, 'chat', 'proximity_range_px'),
    worldRateMsgPerMin: readInteger(configs, 'chat', 'world_rate_msg_per_min'),
    logSize: readInteger(configs, 'chat', 'log_size'),
    messageMaxChars: readInteger(configs, 'chat', 'message_max_chars'),
    blockListMax: readInteger(configs, 'chat', 'block_list_max'),
    emoteIds,
  };
}

export function loadReportConfig(configs: Map<string, ConfigFile>): ReportConfig {
  return {
    reportRateLimitPerMin: readInteger(configs, 'reports', 'report_rate_limit_per_min'),
    reportFreeTextMax: readInteger(configs, 'reports', 'report_free_text_max'),
    contextLineCount: readInteger(configs, 'reports', 'context_line_count'),
    maxStoredReports: readInteger(configs, 'reports', 'reports_in_memory_max'),
  };
}
