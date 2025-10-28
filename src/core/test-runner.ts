import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AIAgentClient } from './ai-agent-client';
import { JestRunner } from './jest-runner';
// Stability judgment is now local; no LLM prompt needed
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

    // Compute local stability score using parsed MR responses
    const { scoreStability } = await import('./stability-scorer');
    const local = scoreStability(responses);
    const score = local.consistencyScore;
    const level = local.consistencyLevel as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
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
        mainIdea: local.mainIdea || '',
        variations: local.variations || [],
        reasoning: local.reasoning || '',
        codeClarity: local.codeClarity || 'AMBIGUOUS',
      },
      executedAt: new Date(),
    };
  }

  private async runTestGeneration(test: Test): Promise<TestGenerationResult> {
    // Determine output directory inside the project to make relative imports resolvable
    const testOutputDir = path.join(this.options.projectPath, this.options.outputDir, 'tests');
    await fs.mkdir(testOutputDir, { recursive: true });

    // If a source file path is provided, compute a relative import path from the test file to the source file
    let modifiedPrompt = test.prompt;
    let computedImportPath: string | undefined;
    if (test.sourceFilePath) {
      const sourceAbsPath = path.resolve(this.options.projectPath, test.sourceFilePath);
      const tentativeRel = path.relative(testOutputDir, sourceAbsPath);
      // Strip .ts/.tsx extension for TS module import style
      const withoutExt = tentativeRel.replace(/\.(ts|tsx)$/i, '');
      // Ensure a relative import starts with ./ or ../
      computedImportPath = withoutExt.startsWith('.') ? withoutExt : `./${withoutExt}`;

      // Provide explicit instruction to the AI to use the computed import path
      const [className, methodName] = this.extractNames(test.targetElement);

      const starter = [
        `import { ${className} } from '${computedImportPath}';`,
        '',
        `describe('${className}.${methodName}', () => {`,
        '  // Arrange common fixtures here',
        '  beforeEach(() => {',
        '    // reset mocks',
        '    jest.clearAllMocks();',
        '  });',
        '',
        "  it('returns expected result for normal input', async () => {",
        '    // Arrange',
        '    // TODO: construct instance/inputs',
        '',
        '    // Act',
        `    // const instance = new ${className}(/* deps */);`,
        `    // const result = await instance.${methodName}(/* args */);`,
        '',
        '    // Assert',
        '    // expect(result).toEqual(/* expected */);',
        '  });',
        '',
        "  it('handles edge cases', async () => {",
        '    // Arrange',
        '    // ...',
        '    // Act',
        '    // ...',
        '    // Assert',
        '    // ...',
        '  });',
        '',
        "  it('throws on invalid input', async () => {",
        '    // Arrange',
        '    // ...',
        '    // Act + Assert',
        `    // await expect((async () => new ${className}().${methodName}(/* bad */))()).rejects.toThrow();`,
        '  });',
        '});',
        '',
      ].join('\n');

      modifiedPrompt = [
        'Generate a complete, self-contained Jest test file for the given target. Follow the rules strictly.',
        '',
        'Rules:',
        '- Return ONLY raw TypeScript code (no markdown, no fences).',
        '- Do NOT inline the implementation; import the module under test.',
        `- Use this exact import path: ${computedImportPath}`,
        `- Target method: ${className}.${methodName}`,
        '- Use only Jest and ts-jest (no extra dependencies).',
        '- Prefer AAA structure and include at least 3 test cases (normal, edge, error).',
        '- Test only public API; do NOT access private/protected members.',
        '- Avoid contrived invalid inputs unless the method is expected to validate/throw.',
        '- Do not mock internal modules unless necessary to isolate the unit.',
        '',
        'Starter File (fill in TODOs; you may add helpers as needed):',
        '```typescript',
        starter,
        '```',
      ].join('\n');
    }

    const aiOutput = await this.agent.call(modifiedPrompt, { timeout: 180_000 });
    const [className2, methodName2] = this.extractNames(test.targetElement);
    const finalCode = this.sanitizeGeneratedTest(aiOutput, computedImportPath, className2);
    const testFilePath = path.join(testOutputDir, `${test.id}.test.ts`);
    await fs.writeFile(testFilePath, finalCode, 'utf8');

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
          generatedTest: finalCode,
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
        generatedTest: finalCode,
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

  private extractNames(targetElement?: string): [string, string] {
    if (!targetElement) {
      return ['TargetClass', 'targetMethod'];
    }
    const parts = String(targetElement).split('.');
    if (parts.length >= 2) {
      const methodName = parts.pop() as string;
      const className = parts.join('.');
      return [className || 'TargetClass', methodName || 'targetMethod'];
    }
    // Fallback: could not split; use the whole as class and a generic method
    return [targetElement, 'targetMethod'];
  }

  private sanitizeGeneratedTest(raw: string, importPath?: string, className?: string): string {
    let code = raw.trim();
    // Extract from markdown fences if present
    const fenceMatch = code.match(/```(?:typescript|ts)?\n([\s\S]*?)\n```/i);
    if (fenceMatch) {
      code = fenceMatch[1];
    } else {
      // Strip stray backticks if any
      code = code.replace(/```/g, '');
    }

    // Normalize line endings
    code = code.replace(/\r\n?/g, '\n');

    // Remove stray language tag lines at the top (e.g., 'typescript')
    code = code.replace(/^(typescript|ts)\n/, '');

    // Ensure import path for the class under test is correct
    if (importPath && className) {
      const importRegex = new RegExp(
        `import\\s*\\{\\s*${this.escapeRegExp(className)}\\s*\\}\\s*from\\s*['\"][^'\"]+['\"];?`
      );
      if (importRegex.test(code)) {
        code = code.replace(/(from\s*['\"])([^'\"]+)(['\"])/, (_m, p1, _p2, p3) => `${p1}${importPath}${p3}`);
      } else {
        code = `import { ${className} } from '${importPath}';\n` + code;
      }
    }

    return code;
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
