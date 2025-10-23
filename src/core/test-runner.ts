import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AIAgentClient } from './ai-agent-client';
import { JestRunner } from './jest-runner';
import { buildStabilityJudgmentPrompt } from '../templates';
import { Test, TestGenerationResult, TestResult, StaticAnalysisResult, StabilityResult } from '../types';

interface TestRunnerOptions {
  projectPath: string;
  outputDir: string;
  verbose?: boolean;
}

export class TestRunner {
  constructor(
    private readonly agent: AIAgentClient,
    private readonly jestRunner: JestRunner,
    private readonly options: TestRunnerOptions,
  ) {}

  async run(tests: Test[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const test of tests) {
      const start = Date.now();
      try {
        let result: TestResult;
        if (test.type === 'static-analysis') {
          result = await this.runStaticAnalysis(test);
        } else if (test.type === 'stability') {
          result = await this.runStability(test);
        } else {
          result = await this.runTestGeneration(test);
        }

        result.executionTimeMs = Date.now() - start;
        results.push(result);
      } catch (error: any) {
        results.push({
          testId: test.id,
          testName: test.name,
          type: test.type,
          passed: false,
          targetElement: test.targetElement,
          error: error?.message || String(error),
          executedAt: new Date(),
        });
      }
    }

    return results;
  }

  private async runStaticAnalysis(test: Test): Promise<StaticAnalysisResult> {
    const raw = await this.agent.call(test.prompt);
    const parsed = this.parseJson(raw, test.id);

    const passed = !!(parsed?.nameAccuracy && parsed?.clarity !== 'LOW');
    const score = typeof parsed?.nameAccuracyScore === 'number' ? parsed.nameAccuracyScore : undefined;

    return {
      testId: test.id,
      testName: test.name,
      type: 'static-analysis',
      passed,
      targetElement: test.targetElement,
      score,
      data: parsed,
      executedAt: new Date(),
    };
  }

  private async runStability(test: Test): Promise<StabilityResult> {
    const iterations = test.iterations ?? 5;
    const responses: string[] = [];

    for (let i = 0; i < iterations; i += 1) {
      const response = await this.agent.call(test.prompt);
      responses.push(response.trim());
    }

    const judgmentPrompt = buildStabilityJudgmentPrompt({
      originalQuestion: this.extractQuestion(test.prompt),
      code: this.extractCode(test.prompt),
      responses,
    });

    const judgmentRaw = await this.agent.call(judgmentPrompt);
    const parsed = this.parseJson(judgmentRaw, test.id);

    const score = typeof parsed?.consistencyScore === 'number' ? parsed.consistencyScore : 0;
    const level = parsed?.consistencyLevel as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
    const passed = score >= 50;

    return {
      testId: test.id,
      testName: test.name,
      type: 'stability',
      passed,
      targetElement: test.targetElement,
      score,
      data: {
        responses,
        consistencyScore: score,
        consistencyLevel: level || 'LOW',
        mainIdea: parsed?.mainIdea || '',
        variations: parsed?.variations || [],
        reasoning: parsed?.reasoning || '',
        codeClarity: parsed?.codeClarity || 'AMBIGUOUS',
      },
      executedAt: new Date(),
    };
  }

  private async runTestGeneration(test: Test): Promise<TestGenerationResult> {
    const generatedTest = await this.agent.call(test.prompt, { timeout: 180_000 });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-comp-test-'));
    const testFilePath = path.join(tmpDir, `${test.id}.test.ts`);
    await fs.writeFile(testFilePath, generatedTest, 'utf8');

    const jestResult = await this.jestRunner.run(testFilePath);

    if (jestResult.passed) {
      return {
        testId: test.id,
        testName: test.name,
        type: 'test-generation',
        passed: true,
        targetElement: test.targetElement,
        score: 100,
        data: {
          generatedTest,
          jestOutput: jestResult.output,
        },
        executedAt: new Date(),
      };
    }

    return {
      testId: test.id,
      testName: test.name,
      type: 'test-generation',
      passed: false,
      targetElement: test.targetElement,
      score: 0,
      data: {
        generatedTest,
        jestOutput: jestResult.output,
        errorAnalysis: this.analyzeJestError(jestResult.output),
      },
      executedAt: new Date(),
    };
  }

  private parseJson(raw: string, testId: string): any {
    try {
      return JSON.parse(raw);
    } catch (error) {
      const fenceMatch = raw.match(/```json\n([\s\S]+?)\n```/i);
      if (fenceMatch) {
        try {
          return JSON.parse(fenceMatch[1]);
        } catch {
          // ignore
        }
      }

      const objMatch = raw.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]);
        } catch {
          // ignore
        }
      }

      throw new Error(`Failed to parse AI output for ${testId}`);
    }
  }

  private analyzeJestError(output: string) {
    const expectedCalls = Array.from(output.matchAll(/Expected (.+?) to have been called/g)).map((match) => match[1]);
    const actualCalls = Array.from(output.matchAll(/Received:/g)).length;
    return {
      summary: 'Mock expectations did not match actual calls',
      expectedCalls,
      actualCalls: actualCalls > 0 ? [`Received count: ${actualCalls}`] : [],
    };
  }

  private extractQuestion(prompt: string): string {
    const match = prompt.match(/## Question\n\n([\s\S]+?)\n\nRespond/);
    return match ? match[1].trim() : 'Explain the behavior of this code.';
  }

  private extractCode(prompt: string): string {
    const match = prompt.match(/```typescript\n([\s\S]+?)\n```/);
    return match ? match[1] : '';
  }
}
