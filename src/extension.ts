import * as vscode from 'vscode';

import { createDefaultStartupSuppressionSettings } from './defaultSettings';
import { readStartupSuppressionSettings } from './configuration';
import { extensionLogger } from './logger';
import { StartupTerminalSuppressor } from './startupTerminalSuppressor';

let startupTerminalSuppressor: StartupTerminalSuppressor | undefined;

extensionLogger.initialize();
extensionLogger.installGlobalFailureLogging();
extensionLogger.info('扩展模块已加载。');

/**
 * 扩展激活后立即初始化日志并启动终端抑制逻辑。
 */
export function activate(extensionContext: vscode.ExtensionContext): void {
  try {
    extensionLogger.info('扩展开始激活。');

    let startupSuppressionSettings = createDefaultStartupSuppressionSettings();

    try {
      startupSuppressionSettings = readStartupSuppressionSettings();
      extensionLogger.info(
        `已读取设置，总时长 ${startupSuppressionSettings.totalDurationMs} 毫秒，间隔 ${startupSuppressionSettings.repeatIntervalMs} 毫秒，计划执行 ${startupSuppressionSettings.cycleCount} 轮。`
      );
    } catch (error) {
      extensionLogger.error('读取设置失败，已回退到默认配置。', error);
    }

    startupTerminalSuppressor = new StartupTerminalSuppressor(
      startupSuppressionSettings
    );

    extensionContext.subscriptions.push(startupTerminalSuppressor);

    startupTerminalSuppressor.start();
    extensionLogger.info('扩展激活完成。');
  } catch (error) {
    extensionLogger.error('扩展激活流程失败。', error);
  }
}

/**
 * 扩展停用时记录日志并清理计时器与事件监听。
 */
export async function deactivate(): Promise<void> {
  extensionLogger.info('扩展开始停用。');

  try {
    await startupTerminalSuppressor?.shutdown('extension-deactivate');
  } catch (error) {
    extensionLogger.error('停用时释放启动抑制器失败。', error);
  } finally {
    startupTerminalSuppressor = undefined;
  }

  extensionLogger.info('扩展停用完成。');
}
