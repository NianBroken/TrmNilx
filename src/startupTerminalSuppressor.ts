import * as vscode from 'vscode';

import type { StartupSuppressionSettings } from './configuration';
import { extensionLogger } from './logger';

/**
 * 在启动窗口内重复执行终端抑制逻辑，并持续记录每一轮执行过程。
 */
export class StartupTerminalSuppressor implements vscode.Disposable {
  private static readonly closePanelCommandId = 'workbench.action.closePanel';
  private static readonly killAllCommandId = 'workbench.action.terminal.killAll';

  private readonly disposableStore: vscode.Disposable[] = [];
  private readonly timerHandles: Array<ReturnType<typeof setTimeout>> = [];
  private suppressionDeadlineTimestamp = 0;
  private executedCycleCount = 0;
  private previousCycleStartTimestamp: number | undefined;
  private hasStarted = false;
  private hasCompletedFinalRelease = false;
  private shutdownPromise: Promise<void> | undefined;
  private isDisposed = false;

  public constructor(
    private readonly settings: StartupSuppressionSettings
  ) {}

  /**
   * 从激活瞬间开始安排全部抑制循环。
   */
  public start(): void {
    if (this.isDisposed) {
      extensionLogger.warn('抑制器已释放，忽略重复启动请求。');
      return;
    }

    if (this.hasStarted) {
      extensionLogger.warn('启动抑制已开始，忽略重复启动请求。');
      return;
    }

    this.hasStarted = true;

    const startTimestamp = Date.now();
    this.suppressionDeadlineTimestamp =
      startTimestamp + this.settings.totalDurationMs;

    extensionLogger.info(
      `启动抑制已开始，总时长 ${this.settings.totalDurationMs} 毫秒，间隔 ${this.settings.repeatIntervalMs} 毫秒，计划执行 ${this.settings.cycleCount} 轮。`
    );

    this.registerFallbackListeners();

    void this.executeSuppressionCycle('activation');

    for (
      let cycleIndex = 1;
      cycleIndex < this.settings.cycleCount;
      cycleIndex += 1
    ) {
      const delayMs = cycleIndex * this.settings.repeatIntervalMs;

      extensionLogger.info(
        `已安排第 ${cycleIndex + 1} 轮启动抑制，延迟 ${delayMs} 毫秒。`
      );

      this.timerHandles.push(
        setTimeout(() => {
          void this.executeSuppressionCycle(`scheduled-${cycleIndex + 1}`);
        }, delayMs)
      );
    }

    this.timerHandles.push(
      setTimeout(() => {
        void this.shutdown('startup-window-finished');
      }, this.settings.totalDurationMs + this.settings.repeatIntervalMs)
    );

    extensionLogger.info('启动抑制的最终收尾计时器已安排。');
  }

  /**
   * 在启动窗口内侦听新建终端，并立即再执行一轮抑制。
   */
  private registerFallbackListeners(): void {
    extensionLogger.info('已注册启动窗口内的新建终端监听。');

    this.disposableStore.push(
      vscode.window.onDidOpenTerminal(() => {
        if (!this.isWithinSuppressionWindow()) {
          extensionLogger.info('检测到新建终端，但已超过启动抑制窗口。');
          return;
        }

        extensionLogger.info('检测到启动窗口内新建终端，立即追加一轮抑制。');
        void this.executeSuppressionCycle('terminal-opened');
      })
    );
  }

  /**
   * 同时触发终端终止和终端面板关闭。
   */
  private async executeSuppressionCycle(triggerSource: string): Promise<void> {
    if (this.isDisposed || !this.isWithinSuppressionWindow()) {
      extensionLogger.info(
        `已跳过一轮启动抑制，触发源 ${triggerSource}，原因是抑制器已释放或已超出时间窗口。`
      );
      return;
    }

    const cycleContext = this.createCycleContext(triggerSource);

    extensionLogger.separator();
    extensionLogger.info(
      `${cycleContext.cycleLabel}开始执行启动抑制，触发源 ${triggerSource}。`
    );
    extensionLogger.info(cycleContext.intervalDescription);

    const cycleTasks = [
      this.terminateAllKnownTerminals(cycleContext.cycleLabel),
      this.terminateAllTerminalsViaCommand(cycleContext.cycleLabel),
      this.closeTerminalPanel(cycleContext.cycleLabel)
    ];

    const cycleResults = await Promise.allSettled(cycleTasks);
    let failedTaskCount = 0;

    for (const cycleResult of cycleResults) {
      if (cycleResult.status === 'rejected') {
        failedTaskCount += 1;
        extensionLogger.error(
          `${cycleContext.cycleLabel}中的子任务执行失败，触发源 ${triggerSource}。`,
          cycleResult.reason
        );
      }
    }

    extensionLogger.info(
      `${cycleContext.cycleLabel}已结束，触发源 ${triggerSource}，失败子任务数 ${failedTaskCount}。`
    );
  }

  /**
   * 遍历当前窗口已知终端并直接释放实例，同时记录快照数量。
   */
  private async terminateAllKnownTerminals(cycleLabel: string): Promise<void> {
    const terminalSnapshot = [...vscode.window.terminals];
    extensionLogger.info(
      `${cycleLabel}准备直接释放终端实例，当前快照数量 ${terminalSnapshot.length}。`
    );

    for (const terminal of terminalSnapshot) {
      try {
        extensionLogger.info(
          `${cycleLabel}正在直接释放终端实例: ${terminal.name}。`
        );
        terminal.dispose();
      } catch (error) {
        extensionLogger.error(
          `${cycleLabel}直接释放终端实例失败: ${terminal.name}。`,
          error
        );
      }
    }

    extensionLogger.info(`${cycleLabel}直接释放终端实例的遍历已完成。`);
  }

  /**
   * 通过内置终端命令再次执行全量终止，补足直接释放未覆盖到的情况。
   */
  private async terminateAllTerminalsViaCommand(
    cycleLabel: string
  ): Promise<void> {
    extensionLogger.info(
      `${cycleLabel}开始执行内置命令 ${StartupTerminalSuppressor.killAllCommandId}。`
    );
    await vscode.commands.executeCommand(
      StartupTerminalSuppressor.killAllCommandId
    );
    extensionLogger.info(
      `${cycleLabel}内置命令 ${StartupTerminalSuppressor.killAllCommandId} 执行完成。`
    );
  }

  /**
   * 关闭当前已展开的终端面板。
   */
  private async closeTerminalPanel(cycleLabel: string): Promise<void> {
    extensionLogger.info(
      `${cycleLabel}开始执行内置命令 ${StartupTerminalSuppressor.closePanelCommandId}。`
    );
    await vscode.commands.executeCommand(
      StartupTerminalSuppressor.closePanelCommandId
    );
    extensionLogger.info(
      `${cycleLabel}内置命令 ${StartupTerminalSuppressor.closePanelCommandId} 执行完成。`
    );
  }

  /**
   * 只允许在配置指定的启动窗口内继续执行抑制。
   */
  private isWithinSuppressionWindow(): boolean {
    return Date.now() <= this.suppressionDeadlineTimestamp;
  }

  /**
   * 启动窗口结束后释放事件侦听，避免继续干预用户手动打开的终端。
   */
  private disposeFallbackListeners(): void {
    extensionLogger.info(
      `开始释放启动窗口监听，当前监听数量 ${this.disposableStore.length}。`
    );

    while (this.disposableStore.length > 0) {
      const disposable = this.disposableStore.pop();
      disposable?.dispose();
    }

    extensionLogger.info('启动窗口监听已全部释放。');
  }

  /**
   * 在启动窗口结束前后做最后一次无条件释放，避免残留状态继续滞留。
   */
  public async shutdown(reason: string): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(reason);
    return this.shutdownPromise;
  }

  /**
   * 生成本轮执行上下文，包含轮次编号和与上一轮的实际间隔说明。
   */
  private createCycleContext(triggerSource: string): {
    cycleLabel: string;
    intervalDescription: string;
    triggerSource: string;
  } {
    const currentTimestamp = Date.now();
    this.executedCycleCount += 1;

    const cycleLabel = `第 ${this.executedCycleCount} 轮`;
    let intervalDescription = `${cycleLabel}是首轮执行。`;

    if (typeof this.previousCycleStartTimestamp === 'number') {
      intervalDescription =
        `${cycleLabel}与上一轮启动抑制开始相隔 `
        + `${currentTimestamp - this.previousCycleStartTimestamp} 毫秒。`;
    }

    this.previousCycleStartTimestamp = currentTimestamp;

    return {
      cycleLabel,
      intervalDescription,
      triggerSource
    };
  }

  /**
   * 统一执行最终的无条件释放和资源回收。
   */
  private async performShutdown(reason: string): Promise<void> {
    if (this.isDisposed) {
      extensionLogger.warn(`抑制器已释放，忽略重复收尾请求，来源 ${reason}。`);
      return;
    }

    extensionLogger.separator();
    extensionLogger.info(`开始执行最终收尾，来源 ${reason}。`);

    this.isDisposed = true;

    while (this.timerHandles.length > 0) {
      const timerHandle = this.timerHandles.pop();
      if (timerHandle) {
        clearTimeout(timerHandle);
      }
    }

    if (!this.hasCompletedFinalRelease) {
      this.hasCompletedFinalRelease = true;

      try {
        extensionLogger.info('最终收尾开始执行无条件终端释放。');
        await this.executeFinalUnconditionalRelease();
        extensionLogger.info('最终收尾的无条件终端释放已完成。');
      } catch (error) {
        extensionLogger.error('最终收尾的无条件终端释放失败。', error);
      }
    }

    this.disposeFallbackListeners();
    extensionLogger.info('启动抑制器已释放完成。');
  }

  /**
   * 最后一次不做时间窗口判断，直接终止全部终端并关闭面板。
   */
  private async executeFinalUnconditionalRelease(): Promise<void> {
    await Promise.allSettled([
      vscode.commands.executeCommand(StartupTerminalSuppressor.killAllCommandId),
      vscode.commands.executeCommand(StartupTerminalSuppressor.closePanelCommandId)
    ]);
  }

  public dispose(): void {
    void this.shutdown('dispose');
  }
}
