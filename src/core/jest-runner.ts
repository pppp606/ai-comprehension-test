import path from 'path';
import { execCommand } from './ai-agent-client';

export interface JestResult {
  passed: boolean;
  output: string;
  testResults?: any;
}

export class JestRunner {
  constructor(private readonly projectRoot: string) {}

  async run(testFilePath: string): Promise<JestResult> {
    const relativePath = path.relative(this.projectRoot, testFilePath);
    try {
      const result = await execCommand('npx', ['jest', '--preset', 'ts-jest', relativePath, '--runInBand', '--json'], {
        cwd: this.projectRoot,
        timeout: 120_000,
      });
      let parsed: any;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        parsed = undefined;
      }
      return {
        passed: true,
        output: result.stdout,
        testResults: parsed,
      };
    } catch (error: any) {
      let parsed: any;
      if (error?.stdout) {
        try {
          parsed = JSON.parse(error.stdout);
        } catch {
          parsed = undefined;
        }
      }
      return {
        passed: false,
        output: error?.stdout || error?.message || 'Unknown Jest error',
        testResults: parsed,
      };
    }
  }
}
