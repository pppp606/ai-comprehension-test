import { spawn } from 'child_process';
import path from 'path';
import { AIAgentConfig, CallOptions, ExecOptions, ExecResult } from '../types';
import { extractFactsFromCode } from './groundedness-checker';

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

    if (command === 'local-mr') {
      return this.callLocal(prompt);
    }

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

  private callLocal(prompt: string): string {
    // Detect prompt type by markers
    if (/Respond ONLY with JSON in this exact format/.test(prompt) && /nameAccuracy/.test(prompt)) {
      // static-analysis shape
      return JSON.stringify({
        nameAccuracy: true,
        nameAccuracyScore: 85,
        issues: [],
        suggestions: [],
        clarity: 'HIGH',
        reasoning: 'Name broadly matches implementation.'
      });
    }

    // Stability MR expected (contains primaryPurpose field in schema section)
    if (/primaryPurpose/.test(prompt) && /## Output/.test(prompt)) {
      const code = this.extractCode(prompt);
      const docDefaults = this.extractDocDefaults(code);
      const facts = extractFactsFromCode(code);
      const hasOnOff = facts.some((f) => f.kind === 'constant');
      const hasTimeoutNorm = facts.some((f) => f.kind === 'timeout');
      const factLimits = facts
        .filter((f) => f.kind === 'limit')
        .map((f) => ({ name: String(f.key || 'value'), min: f.min, max: f.max, unit: f.unit || (f.max || f.min ? 'ms' : undefined) }));

      const mr = {
        primaryPurpose: 'Manage connections with optional retries and timeouts',
        inputs: ['endpoint'],
        outputs: ['none'],
        sideEffects: ['time delays', 'randomized attempts'],
        keyBehaviors: ['attempt connection', 'apply retry policy', 'respect timeout'],
        invariants: ['throws on failure'],
        defaults: docDefaults,
        normalization: hasTimeoutNorm ? [{ from: 's', to: 'ms' }] : [],
        limits: factLimits,
        constants: hasOnOff ? ['on', 'off'] : [],
        errorConditions: ['all attempts fail'],
        unknowns: [],
      };
      return JSON.stringify(mr);
    }

    // Test generation: return a minimal TS test file
    if (/You are generating a Jest test file/.test(prompt)) {
      return [
        "import { describe, it, expect } from '@jest/globals';",
        'describe("Generated", () => {',
        '  it("placeholder", () => {',
        '    expect(true).toBe(true);',
        '  });',
        '});',
        ''
      ].join('\n');
    }

    // Default fallback
    return '';
  }

  private extractCode(prompt: string): string {
    const match = prompt.match(/```typescript\n([\s\S]+?)\n```/);
    return match ? match[1] : '';
  }

  private extractDocDefaults(code: string): Record<string, number | string | boolean> {
    const out: Record<string, number | string | boolean> = {};
    const headerMatch = code.match(/\/\*\*[\s\S]*?\*\//);
    const header = headerMatch ? headerMatch[0] : '';
    function setDefault(key: string, val: string) {
      if (/^(true|false)$/i.test(val)) out[key] = /^true$/i.test(val);
      else if (/^\d+s$/.test(val)) out[key] = parseInt(val, 10) * 1000;
      else if (/^\d+ms$/.test(val)) out[key] = parseInt(val, 10);
      else if (/^\d+$/.test(val)) out[key] = parseInt(val, 10);
      else out[key] = val;
    }
    const lines = header.split(/\r?\n/).map((l) => l.replace(/^\s*\*\s?/, '').trim());
    for (const line of lines) {
      const m1 = line.match(/-\s*timeout:\s*([0-9]+\s*s|[0-9]+\s*ms|[0-9]+)\b/i);
      if (m1) setDefault('timeoutMs', m1[1].replace(/\s+/g, ''));
      const m2 = line.match(/-\s*retries:\s*([0-9]+)/i);
      if (m2) setDefault('retryLimit', m2[1]);
      const m3 = line.match(/-\s*secure:\s*(true|false)/i);
      if (m3) setDefault('secure', m3[1].toLowerCase());
    }
    return out;
  }
}
