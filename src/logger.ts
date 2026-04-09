import * as vscode from 'vscode';

const outputChannelName = 'TrmNilx';
const maximumBufferedLineCount = 2000;

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * 统一负责输出面板日志、控制台兜底和全局异常记录。
 */
class ExtensionLogger {
  private outputChannel: vscode.OutputChannel | undefined;
  private readonly bufferedLines: string[] = [];
  private globalFailureLoggingInstalled = false;

  /**
   * 尽早初始化输出通道，并把启动前暂存的日志刷入输出面板。
   */
  public initialize(): void {
    this.ensureOutputChannel();
  }

  /**
   * 安装进程级异常日志兜底，确保未处理异常也能被记录。
   */
  public installGlobalFailureLogging(): void {
    if (this.globalFailureLoggingInstalled) {
      return;
    }

    this.globalFailureLoggingInstalled = true;

    process.on('uncaughtExceptionMonitor', (error, origin) => {
      this.error(`捕获到未处理异常监视事件，来源: ${origin}。`, error);
    });

    process.on('unhandledRejection', (reason) => {
      this.error('捕获到未处理 Promise 拒绝。', reason);
    });

    process.on('warning', (warning) => {
      this.warn(`捕获到进程警告: ${warning.name}。`, warning);
    });

    process.on('exit', (exitCode) => {
      this.info(`扩展宿主进程即将退出，退出码: ${exitCode}。`);
    });

    this.info('全局异常日志兜底已安装。');
  }

  /**
   * 输出普通信息。
   */
  public info(message: string): void {
    this.write('INFO', message);
  }

  /**
   * 输出警告信息。
   */
  public warn(message: string, error?: unknown): void {
    this.write('WARN', message, error);
  }

  /**
   * 输出错误信息。
   */
  public error(message: string, error?: unknown): void {
    this.write('ERROR', message, error);
  }

  /**
   * 在轮次之间插入清晰分隔线，便于观察启动抑制节奏。
   */
  public separator(): void {
    this.write('INFO', '----------------------------------------');
  }

  /**
   * 为单行或多行消息统一补齐时间和级别前缀，并吞掉日志系统自身异常。
   */
  private write(level: LogLevel, message: string, error?: unknown): void {
    try {
      const logLines = [
        ...this.createPrefixedLines(level, message),
        ...this.createErrorLines(level, error)
      ];

      this.writeLines(logLines);
    } catch (writeError) {
      this.writeLinesToConsole([
        `${this.createTimestamp()} ERROR 日志系统内部写入失败。`
      ]);
      this.writeRawErrorToConsole(writeError);
      this.writeRawErrorToConsole(error);
    }
  }

  /**
   * 优先写入输出面板，失败时自动退回控制台并保留缓冲。
   */
  private writeLines(logLines: string[]): void {
    this.bufferLines(logLines);
    this.writeLinesToConsole(logLines);
    this.flushBufferedLinesToOutputChannel();
  }

  /**
   * 输出通道不存在时自动重新创建。
   */
  private ensureOutputChannel(): vscode.OutputChannel | undefined {
    if (this.outputChannel) {
      return this.outputChannel;
    }

    try {
      this.outputChannel = vscode.window.createOutputChannel(outputChannelName);
      return this.outputChannel;
    } catch (error) {
      this.writeLinesToConsole(
        this.createPrefixedLines('ERROR', '创建输出通道失败。')
      );
      this.writeRawErrorToConsole(error);
      return undefined;
    }
  }

  /**
   * 把缓冲区中的日志按原顺序刷入输出面板。
   */
  private flushBufferedLinesToOutputChannel(): void {
    const outputChannel = this.ensureOutputChannel();

    if (!outputChannel || this.bufferedLines.length === 0) {
      return;
    }

    try {
      for (const bufferedLine of this.bufferedLines) {
        outputChannel.appendLine(bufferedLine);
      }

      this.bufferedLines.length = 0;
    } catch (error) {
      this.outputChannel = undefined;
      this.writeLinesToConsole(
        this.createPrefixedLines('ERROR', '写入输出通道失败。')
      );
      this.writeRawErrorToConsole(error);
    }
  }

  /**
   * 输出面板不可用时，仍然把日志保留在内存缓冲区中等待后续重试。
   */
  private bufferLines(logLines: string[]): void {
    this.bufferedLines.push(...logLines);

    if (this.bufferedLines.length > maximumBufferedLineCount) {
      this.bufferedLines.splice(
        0,
        this.bufferedLines.length - maximumBufferedLineCount
      );
    }
  }

  /**
   * 控制台兜底始终同步输出，避免输出面板异常时彻底失去日志。
   */
  private writeLinesToConsole(logLines: string[]): void {
    for (const logLine of logLines) {
      try {
        console.log(logLine);
      } catch {
        // 控制台兜底已经是最后一层保护，这里不再继续抛错。
      }
    }
  }

  /**
   * 直接把底层错误对象写到控制台，避免二次格式化再次出错。
   */
  private writeRawErrorToConsole(error: unknown): void {
    try {
      console.error(error);
    } catch {
      // 原始错误无法再输出时保持静默，避免日志系统自身连锁报错。
    }
  }

  /**
   * 把主消息拆成多行并逐行补齐固定前缀。
   */
  private createPrefixedLines(level: LogLevel, message: string): string[] {
    const timestamp = this.createTimestamp();
    const normalizedMessage = message.trim().length > 0 ? message : '空日志。';

    return normalizedMessage
      .split(/\r?\n/u)
      .map((messageLine) => `${timestamp} ${level} ${messageLine}`);
  }

  /**
   * 把错误对象转换为可读的多行日志。
   */
  private createErrorLines(level: LogLevel, error: unknown): string[] {
    if (error === undefined) {
      return [];
    }

    const timestamp = this.createTimestamp();
    const errorLines: string[] = [];

    if (error instanceof Error) {
      const headerLine = `${error.name}: ${error.message}`;
      errorLines.push(`${timestamp} ${level} ${headerLine}`);

      if (typeof error.stack === 'string' && error.stack.trim().length > 0) {
        const stackLines = error.stack
          .split(/\r?\n/u)
          .map((stackLine) => stackLine.trim())
          .filter(
            (stackLine) =>
              stackLine.length > 0 && stackLine !== headerLine
          );

        for (const stackLine of stackLines) {
          errorLines.push(`${timestamp} ${level} ${stackLine}`);
        }
      }

      return errorLines;
    }

    const fallbackText = this.stringifyUnknownValue(error);

    return fallbackText
      .split(/\r?\n/u)
      .map((errorLine) => `${timestamp} ${level} ${errorLine}`);
  }

  /**
   * 把任意未知值稳定转换为文本，避免循环引用等对象再次触发日志异常。
   */
  private stringifyUnknownValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      const jsonText = JSON.stringify(value, null, 2);

      if (typeof jsonText === 'string' && jsonText.length > 0) {
        return jsonText;
      }
    } catch {
      // JSON 转换失败时继续走字符串兜底。
    }

    try {
      return String(value);
    } catch {
      return '无法序列化的错误对象。';
    }
  }

  /**
   * 生成固定格式的本地时间戳，精确到秒。
   */
  private createTimestamp(): string {
    const now = new Date();

    return [
      now.getFullYear(),
      this.padTimePart(now.getMonth() + 1),
      this.padTimePart(now.getDate())
    ].join('-')
      + ` ${this.padTimePart(now.getHours())}`
      + `:${this.padTimePart(now.getMinutes())}`
      + `:${this.padTimePart(now.getSeconds())}`;
  }

  /**
   * 保证时间字段始终为两位数字。
   */
  private padTimePart(value: number): string {
    return value.toString().padStart(2, '0');
  }
}

export const extensionLogger = new ExtensionLogger();
