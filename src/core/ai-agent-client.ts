import { spawn } from 'child_process';
import path from 'path';
import { AIAgentConfig, CallOptions, ExecOptions, ExecResult } from '../types';

export const DEFAULT_AGENT_CONFIG: AIAgentConfig = {
  command: 'claude',
  args: ['-p'],
  workingDir: process.cwd(),
  timeout: 180_000,
};

export function loadAIAgentConfig(): AIAgentConfig {
  const command = process.env.AI_COMP_TEST_COMMAND || DEFAULT_AGENT_CONFIG.command;
  const argsRaw = process.env.AI_COMP_TEST_ARGS || DEFAULT_AGENT_CONFIG.args.join(' ');
  const timeoutSec = Number.parseInt(process.env.AI_COMP_TEST_TIMEOUT || '180', 10);
  const timeout = Number.isNaN(timeoutSec) ? DEFAULT_AGENT_CONFIG.timeout : timeoutSec * 1000;
  const workingDir = process.env.AI_COMP_TEST_WORKDIR
    ? path.resolve(process.env.AI_COMP_TEST_WORKDIR)
    : DEFAULT_AGENT_CONFIG.workingDir;

  return {
    command,
    args: argsRaw.split(' ').filter(Boolean),
    workingDir,
    timeout,
  };
}

export function execCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    if (!child) {
      const err = new Error('Failed to spawn process');
      (err as any).code = 'ESPAWN';
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = options.timeout
      ? setTimeout(() => {
          child.kill();
          reject(Object.assign(new Error('Command timeout'), { code: 'ETIMEDOUT' }));
        }, options.timeout)
      : undefined;

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      } else {
        const err = new Error(`Command failed with exit code ${code}`);
        (err as any).code = 'ECOMMAND';
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
        (err as any).exitCode = code;
        reject(err);
      }
    });

    if (options.input && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

export class AIAgentClient {
  constructor(private readonly config: AIAgentConfig) {}

  async call(prompt: string, options?: CallOptions): Promise<string> {
    const command = this.config.command;
    const workingDir = options?.workingDir || this.config.workingDir;
    const timeout = options?.timeout || this.config.timeout;

    if (command === 'claude') {
      const result = await execCommand(command, this.config.args, {
        input: prompt,
        cwd: workingDir,
        timeout,
      });
      return result.stdout.trim();
    }

    if (command === 'codex') {
      const execArgs = [...this.config.args, prompt];
      const result = await execCommand(command, execArgs, {
        cwd: workingDir,
        timeout,
      });
      return result.stdout.trim();
    }

    const execArgs = [...this.config.args, prompt];
    const result = await execCommand(command, execArgs, {
      input: command === 'claude' ? prompt : undefined,
      cwd: workingDir,
      timeout,
    });
    return result.stdout.trim();
  }
}
