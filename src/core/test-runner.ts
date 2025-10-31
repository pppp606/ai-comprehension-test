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
    const iterations = Number(process.env.AI_COMP_TEST_STABILITY_ITER || '') || (test.iterations ?? 5);
    const repeats = Math.max(1, Number(process.env.AI_COMP_TEST_REPEAT || '1'));

    function median(nums: number[]): number {
      const arr = nums.slice().filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      if (!arr.length) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    }

    const runOnce = async () => {
      const responses: string[] = [];
      for (let i = 0; i < iterations; i += 1) {
        const response = await this.agent.call(test.prompt);
        responses.push(response.trim());
      }
      const mode = process.env.AI_COMP_TEST_STABILITY_MODE || 'tfidf';
      let local: any;
      if (mode === 'embedding') {
        const { scoreStabilityEmbedding } = await import('./stability-scorer');
        local = await scoreStabilityEmbedding(responses);
      } else {
        const { scoreStability } = await import('./stability-scorer');
        local = scoreStability(responses);
      }

      let coverage: { schemaCoverage: number; specificity: number; specificityModel?: number } | undefined = local.coverage as any;
      let adjustedScore = local.consistencyScore as number;
      let adjustedLevel = local.consistencyLevel as 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
      let groundedness: { score: number; mismatches: Array<{ fact: string; claim: string; note?: string }>; factCoverage?: number } | undefined;
      try {
        const code = (this as any).extractCode(test.prompt) as string;
        const first = responses[0];
        if (code && first) {
          const parsed = this.parseJson(first, test.id);
          const { computeGroundedness } = await import('./groundedness-checker');
          const gr = computeGroundedness(code, parsed);
          groundedness = { score: gr.score, mismatches: gr.mismatches as any, factCoverage: gr.factCoverage };

          // recompute coverage from parsed
          const slots: Array<[string, unknown]> = [
            ['defaults', parsed?.defaults],
            ['normalization', parsed?.normalization],
            ['limits', parsed?.limits],
            ['constants', parsed?.constants],
            ['errorConditions', parsed?.errorConditions],
          ];
          let filled = 0;
          let total = 0;
          for (const [, val] of slots) {
            total += 1;
            let hasContent = false;
            if (Array.isArray(val)) hasContent = val.length > 0;
            else if (val && typeof val === 'object') hasContent = Object.keys(val as object).length > 0;
            else hasContent = !!val;
            if (hasContent) filled += 1;
          }
          const schemaCoverageComputed = total ? Math.round((filled / total) * 100) : 0;
          const textParts: string[] = [];
          if (parsed?.primaryPurpose) textParts.push(parsed.primaryPurpose);
          for (const f of [parsed?.inputs, parsed?.outputs, parsed?.sideEffects, parsed?.keyBehaviors, parsed?.invariants]) {
            for (const v of (f as string[] | undefined) || []) textParts.push(String(v));
          }
          const nums = textParts.join(' ').match(/-?\d+(?:\.\d+)?/g)?.length || 0;
          const bools = (textParts.join(' ').match(/\b(true|false|on|off)\b/gi) || []).length;
          const amb = (textParts.join(' ').match(/\b(maybe|might|possibly|could|usually|typically|around|about|approximately|roughly|sometimes)\b/gi) || []).length;
          const raw = (Math.atan((nums + bools) / 3) / (Math.PI / 2)) * 100;
          const specificityComputed = Math.max(0, Math.min(100, Math.round(raw - Math.min(30, amb * 5))));
          coverage = { schemaCoverage: schemaCoverageComputed, specificity: specificityComputed } as any;

          if (process.env.AI_COMP_TEST_AMBIGUITY === 'model' || process.env.AI_COMP_TEST_AMBIGUITY === 'hybrid') {
            try {
              const { ambiguityScores, mrToText } = await import('./ambiguity');
              const text = mrToText(parsed);
              const scores = await ambiguityScores(text);
              (coverage as any).specificityModel = scores.specific;
              if (process.env.AI_COMP_TEST_INCLUDE_AMBIGUITY_IN_SCORE === '1') {
                const w = Math.min(0.5, Math.max(0, Number(process.env.AI_COMP_TEST_AMBIGUITY_WEIGHT || '0.15')));
                adjustedScore = Math.round(adjustedScore * (1 - w) + scores.specific * w);
                adjustedLevel = adjustedScore >= 75 ? 'HIGH' : adjustedScore >= 50 ? 'MEDIUM' : 'LOW';
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {}

      const passed = adjustedScore >= 50;
      return {
        testId: test.id,
        testName: test.name,
        type: 'stability',
        passed,
        targetElement: test.targetElement,
        score: adjustedScore,
        data: {
          responses,
          consistencyScore: adjustedScore,
          consistencyLevel: adjustedLevel || 'LOW',
          mainIdea: local.mainIdea || '',
          variations: local.variations || [],
          reasoning: local.reasoning || '',
          codeClarity: local.codeClarity || 'AMBIGUOUS',
          coverage: coverage,
          groundedness: groundedness,
        },
        executedAt: new Date(),
      } as StabilityResult;
    };

    if (repeats === 1) {
      return await runOnce();
    }

    const runs: StabilityResult[] = [];
    for (let r = 0; r < repeats; r++) runs.push(await runOnce());

    const scores = runs.map((r) => r.score || 0);
    const covSchema = runs.map((r) => r.data?.coverage?.schemaCoverage ?? 0);
    const covSpec = runs.map((r) => r.data?.coverage?.specificity ?? 0);
    const covSpecM = runs.map((r) => r.data?.coverage?.specificityModel).filter((v): v is number => typeof v === 'number');
    const grd = runs.map((r) => r.data?.groundedness?.score).filter((v): v is number => typeof v === 'number');
    const grdFC = runs.map((r) => r.data?.groundedness?.factCoverage).filter((v): v is number => typeof v === 'number');

    const mScore = median(scores);
    const mLevel: 'HIGH' | 'MEDIUM' | 'LOW' = mScore >= 75 ? 'HIGH' : mScore >= 50 ? 'MEDIUM' : 'LOW';

    return {
      testId: test.id,
      testName: test.name,
      type: 'stability',
      passed: mScore >= 50,
      targetElement: test.targetElement,
      score: mScore,
      data: {
        responses: [],
        consistencyScore: mScore,
        consistencyLevel: mLevel,
        mainIdea: runs[0].data?.mainIdea || '',
        variations: runs[0].data?.variations || [],
        reasoning: `Median over ${repeats} runs`,
        codeClarity: runs[0].data?.codeClarity || 'AMBIGUOUS',
        coverage: {
          schemaCoverage: median(covSchema),
          specificity: median(covSpec),
          specificityModel: covSpecM.length ? median(covSpecM) : undefined,
        },
        groundedness: grd.length ? { score: median(grd), mismatches: [], factCoverage: grdFC.length ? median(grdFC) : undefined } : undefined,
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
