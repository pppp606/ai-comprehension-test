import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
// Intentionally avoid importing the module under test at top-level.
// We will dynamically import after setting up jest mocks in each test.

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

describe('loadAIAgentConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns defaults when no env vars provided', async () => {
    const { loadAIAgentConfig: freshLoad, DEFAULT_AGENT_CONFIG } = await import('../ai-agent-client');
    const config = freshLoad();
    expect(config).toEqual(DEFAULT_AGENT_CONFIG);
  });

  it('parses environment overrides correctly', async () => {
    process.env.AI_COMP_TEST_COMMAND = 'codex';
    process.env.AI_COMP_TEST_ARGS = 'exec --fast';
    process.env.AI_COMP_TEST_TIMEOUT = '120';
    process.env.AI_COMP_TEST_WORKDIR = '/tmp/project';

    const { loadAIAgentConfig: freshLoad } = await import('../ai-agent-client');
    const config = freshLoad();

    expect(config.command).toBe('codex');
    expect(config.args).toEqual(['exec', '--fast']);
    expect(config.timeout).toBe(120_000);
    expect(config.workingDir).toBe('/tmp/project');
  });
});

describe('execCommand', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('resolves with stdout and stderr on successful execution', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    const child = createMockChildProcess({ exitCode: 0, stdout: 'hello', stderr: 'warn' });
    (spawnMock as jest.Mock).mockReturnValue(child as any);

    const { execCommand } = await import('../ai-agent-client');
    const result = await execCommand('echo', ['hello'], { input: 'hello' });

    expect(result).toEqual({ stdout: 'hello', stderr: 'warn', exitCode: 0 });
    expect(child.stdin?.write).toHaveBeenCalledWith('hello');
  });

  it('rejects with metadata when process exits with non-zero code', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    const child = createMockChildProcess({ exitCode: 2, stdout: 'output', stderr: 'error' });
    (spawnMock as jest.Mock).mockReturnValue(child as any);

    const { execCommand } = await import('../ai-agent-client');
    await expect(execCommand('bad', [], {})).rejects.toMatchObject({
      code: 'ECOMMAND',
      stdout: 'output',
      stderr: 'error',
    });
  });

  it('rejects with timeout error and kills the process', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    jest.useFakeTimers();
    const child = createMockChildProcess({ exitCode: null });
    (spawnMock as jest.Mock).mockReturnValue(child as any);

    const { execCommand } = await import('../ai-agent-client');
    const promise = execCommand('sleep', [], { timeout: 1000 });
    jest.runAllTimers();

    await expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(child.kill).toHaveBeenCalled();
  });
});

describe('AIAgentClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls Claude command with stdin input', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    const child = createMockChildProcess({ exitCode: 0, stdout: 'result' });
    (spawnMock as jest.Mock).mockReturnValue(child as any);

    const { AIAgentClient } = await import('../ai-agent-client');
    const client = new AIAgentClient({
      command: 'claude',
      args: ['-p'],
      workingDir: '/repo',
      timeout: 30_000,
    });

    const response = await client.call('prompt text');

    expect(response).toBe('result');
    expect(spawnMock).toHaveBeenCalledWith('claude', ['-p'], expect.objectContaining({ cwd: '/repo' }));
    expect(child.stdin?.write).toHaveBeenCalledWith('prompt text');
  });

  it('passes prompt as argument for codex command', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    const child = createMockChildProcess({ exitCode: 0, stdout: 'codex response' });
    (spawnMock as jest.Mock).mockReturnValue(child as any);
    const { AIAgentClient } = await import('../ai-agent-client');
    const client = new AIAgentClient({
      command: 'codex',
      args: ['exec'],
      workingDir: '/repo',
      timeout: 45_000,
    });

    const response = await client.call('generate tests');

    expect(response).toBe('codex response');
    expect(spawnMock).toHaveBeenCalledWith('codex', ['exec', 'generate tests'], expect.any(Object));
  });

  it('falls back to passing prompt via args for custom command', async () => {
    const { spawn } = await import('child_process');
    const spawnMock = spawn as unknown as jest.Mock;
    const child = createMockChildProcess({ exitCode: 0, stdout: 'ok' });
    (spawnMock as jest.Mock).mockReturnValue(child as any);
    const { AIAgentClient } = await import('../ai-agent-client');
    const client = new AIAgentClient({
      command: 'my-agent',
      args: ['run'],
      workingDir: '/repo',
      timeout: 10_000,
    });

    const response = await client.call('explain');

    expect(response).toBe('ok');
    expect(spawnMock).toHaveBeenCalledWith('my-agent', ['run', 'explain'], expect.any(Object));
  });
});

function createMockChildProcess({
  exitCode,
  stdout = '',
  stderr = '',
}: {
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
}): ChildProcess & {
  stdout: any;
  stderr: any;
  stdin?: { write: ReturnType<typeof jest.fn>; end: ReturnType<typeof jest.fn> };
} {
  const emitter = new EventEmitter() as ChildProcess & {
    stdout: any;
    stderr: any;
    stdin?: { write: ReturnType<typeof jest.fn>; end: ReturnType<typeof jest.fn> };
  };

  emitter.stdout = new EventEmitter() as any;
  emitter.stderr = new EventEmitter() as any;
  emitter.stdin = { write: jest.fn(), end: jest.fn() } as any;
  (emitter as any).kill = jest.fn();

  process.nextTick(() => {
    if (stdout) {
      emitter.stdout.emit('data', Buffer.from(stdout));
    }
    if (stderr) {
      emitter.stderr.emit('data', Buffer.from(stderr));
    }
    if (exitCode !== null) {
      emitter.emit('close', exitCode);
    }
  });

  return emitter;
}
