import * as vscode from 'vscode';

import { createDefaultStartupSuppressionSettings } from './defaultSettings';
import { extensionLogger } from './logger';

export const extensionConfigurationSection = 'trmnilx';
export const startupSuppressionSection = 'startupSuppression';
export const totalDurationSettingName = 'totalDurationMs';
export const repeatIntervalSettingName = 'repeatIntervalMs';

export interface StartupSuppressionSettings {
  totalDurationMs: number;
  repeatIntervalMs: number;
  cycleCount: number;
}

/**
 * 读取并规范化启动抑制配置，保证后续调度始终使用正整数毫秒值。
 */
export function readStartupSuppressionSettings(): StartupSuppressionSettings {
  const defaultSettings = createDefaultStartupSuppressionSettings();
  const configuration = vscode.workspace.getConfiguration(
    extensionConfigurationSection
  );

  const totalDurationMs = normalizePositiveMilliseconds(
    configuration.get<number>(
      `${startupSuppressionSection}.${totalDurationSettingName}`,
      defaultSettings.totalDurationMs
    ),
    defaultSettings.totalDurationMs,
    `${extensionConfigurationSection}.${startupSuppressionSection}.${totalDurationSettingName}`
  );

  const repeatIntervalMs = normalizePositiveMilliseconds(
    configuration.get<number>(
      `${startupSuppressionSection}.${repeatIntervalSettingName}`,
      defaultSettings.repeatIntervalMs
    ),
    defaultSettings.repeatIntervalMs,
    `${extensionConfigurationSection}.${startupSuppressionSection}.${repeatIntervalSettingName}`
  );

  return {
    totalDurationMs,
    repeatIntervalMs,
    cycleCount: 1 + Math.floor(totalDurationMs / repeatIntervalMs)
  };
}

/**
 * 把任意输入收敛为正整数毫秒值。
 */
function normalizePositiveMilliseconds(
  rawValue: number | undefined,
  fallbackValue: number,
  settingKey: string
): number {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    extensionLogger.warn(
      `设置项 ${settingKey} 不是有效数字，已回退到默认值 ${fallbackValue}。`
    );
    return fallbackValue;
  }

  const normalizedValue = Math.floor(rawValue);

  if (normalizedValue < 1) {
    extensionLogger.warn(
      `设置项 ${settingKey} 小于 1，已回退到默认值 ${fallbackValue}。`
    );
    return fallbackValue;
  }

  return normalizedValue;
}
