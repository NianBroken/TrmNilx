import type { StartupSuppressionSettings } from './configuration';

/**
 * 提供启动抑制的默认配置，供异常兜底和正常初始化共用。
 */
export function createDefaultStartupSuppressionSettings(): StartupSuppressionSettings {
  const totalDurationMs = 1500;
  const repeatIntervalMs = 200;

  return {
    totalDurationMs,
    repeatIntervalMs,
    cycleCount: 1 + Math.floor(totalDurationMs / repeatIntervalMs)
  };
}
