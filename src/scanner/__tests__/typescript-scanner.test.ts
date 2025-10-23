import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { TypeScriptScanner } from '../typescript-scanner';

describe('TypeScriptScanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses classes, methods, and functions from TypeScript files', async () => {
    const filePath = path.join(tempDir, 'service.ts');
    await fs.writeFile(
      filePath,
      `export class UserService {\n` +
        `  private readonly name: string;\n` +
        `  constructor(name: string) {\n` +
        `    this.name = name;\n` +
        `  }\n` +
        `  async process(userId: string): Promise<void> {\n` +
        `    if (!userId) {\n` +
        `      throw new Error('missing');\n` +
        `    }\n` +
        `    console.log(userId);\n` +
        `  }\n` +
        `}\n\n` +
        `export function helper(value: number) {\n` +
        `  return value * 2;\n` +
        `}\n`,
      'utf8',
    );

    const scanner = new TypeScriptScanner();
    const result = await scanner.scan({ projectPath: tempDir });

    expect(result.totalFiles).toBe(1);
    expect(result.classes).toHaveLength(1);
    expect(result.functions).toHaveLength(1);

    const cls = result.classes[0];
    expect(cls.name).toBe('UserService');
    expect(cls.isExported).toBe(true);
    expect(cls.methods).toHaveLength(1);

    const method = cls.methods[0];
    expect(method.name).toBe('process');
    expect(method.parameters[0]).toEqual({ name: 'userId', type: 'string', isOptional: false });
    expect(method.isAsync).toBe(true);
    expect(method.loc).toBeGreaterThanOrEqual(5);

    const fn = result.functions[0];
    expect(fn.name).toBe('helper');
    expect(fn.signature).toContain('helper');
  });

  it('resolves relative file paths when files option is provided', async () => {
    const includedFile = path.join(tempDir, 'included.ts');
    const ignoredFile = path.join(tempDir, 'node_modules', 'ignored.ts');

    await fs.mkdir(path.dirname(ignoredFile), { recursive: true });
    await fs.writeFile(
      includedFile,
      'class PaymentManager { execute() {} }',
      'utf8',
    );
    await fs.writeFile(ignoredFile, 'class ShouldBeIgnored {}', 'utf8');

    const scanner = new TypeScriptScanner();
    const result = await scanner.scan({ projectPath: tempDir, files: ['included.ts'] });

    expect(result.totalFiles).toBe(1);
    expect(result.scannedFiles[0]).toBe(includedFile);
  });
});
