import path from 'path';
import ora from 'ora';
import { TypeScriptScanner } from '../scanner/typescript-scanner';
import { TestGenerator } from '../core/test-generator';
import { loadAIAgentConfig, AIAgentClient } from '../core/ai-agent-client';
import { JestRunner } from '../core/jest-runner';
import { TestRunner } from '../core/test-runner';
import { printConsoleReport } from '../reporter/console-reporter';
import { writeJsonReport } from '../reporter/json-reporter';
import { GenerateOptions, TestResult, TestResults, TestType } from '../types';

interface RunOptions {
  files?: string[];
  output: string;
  format: 'console' | 'json';
  verbose?: boolean;
}

export async function runCommand(projectPath: string, options: RunOptions): Promise<void> {
  const start = Date.now();
  const spinner = ora({ text: 'Scanning project...', isEnabled: !options.verbose }).start();

  const absoluteProjectPath = path.resolve(projectPath);
  const scanner = new TypeScriptScanner();
  let structure;
  try {
    structure = await scanner.scan({ projectPath: absoluteProjectPath, files: options.files });
    spinner.succeed(`Scanned ${structure.scannedFiles.length} file(s)`);
  } catch (error) {
    spinner.fail('Failed to scan project');
    throw error;
  }

  const generatorOptions: GenerateOptions = {
    hasFileSpecification: !!options.files && options.files.length > 0,
  };
  const generator = new TestGenerator(structure, generatorOptions);
  const tests = generator.generate();

  if (tests.length === 0) {
    throw new Error('No tests generated. Try specifying different files or adjust your project code.');
  }

  const agentConfig = loadAIAgentConfig();
  if (options.verbose) {
    console.log('Using AI agent:', agentConfig);
  }

  const agent = new AIAgentClient(agentConfig);
  const jestRunner = new JestRunner(absoluteProjectPath);
  const testRunner = new TestRunner(agent, jestRunner, {
    projectPath: absoluteProjectPath,
    outputDir: options.output,
    verbose: options.verbose,
  });

  const executionSpinner = ora({ text: 'Executing AI comprehension tests...', isEnabled: !options.verbose }).start();
  let results: TestResult[];
  try {
    results = await testRunner.run(tests);
    executionSpinner.succeed(`Executed ${results.length} test(s)`);
  } catch (error) {
    executionSpinner.fail('Failed to execute tests');
    throw error;
  }

  const report = buildReport({
    projectPath: absoluteProjectPath,
    filesSpecified: options.files,
    results,
    startedAt: start,
  });

  if (options.format === 'json') {
    const filePath = await writeJsonReport(report, path.resolve(options.output));
    console.log(`JSON report written to ${filePath}`);
  } else {
    printConsoleReport(report);
  }
}

function buildReport(params: {
  projectPath: string;
  filesSpecified?: string[];
  results: TestResult[];
  startedAt: number;
}): TestResults {
  const { projectPath, filesSpecified, results, startedAt } = params;
  const totalTests = results.length;
  const passedTests = results.filter((result) => result.passed).length;
  const failedTests = totalTests - passedTests;
  const overallScore = calculateAverageScore(results);

  const byTestType: TestResults['byTestType'] = {
    'static-analysis': createTestTypeSummary('static-analysis', results),
    stability: createTestTypeSummary('stability', results),
    'test-generation': createTestTypeSummary('test-generation', results),
  };

  const criticalIssues = buildCriticalIssues(results);

  return {
    summary: {
      projectPath,
      filesSpecified,
      executedAt: new Date().toISOString(),
      totalTests,
      passedTests,
      failedTests,
      overallScore,
      executionTimeMs: Date.now() - startedAt,
    },
    byTestType,
    results,
    criticalIssues,
  };
}

function createTestTypeSummary(type: TestType, results: TestResult[]) {
  const filtered = results.filter((result) => result.type === type);
  const total = filtered.length;
  const passed = filtered.filter((result) => result.passed).length;
  const failed = total - passed;
  const averageScore = filtered.length > 0 ? calculateAverageScore(filtered) : 0;
  return { total, passed, failed, averageScore };
}

function calculateAverageScore(results: TestResult[]): number {
  if (results.length === 0) {
    return 0;
  }
  const scores = results.map((result) => {
    if (typeof result.score === 'number') {
      return result.score;
    }
    return result.passed ? 100 : 0;
  });
  const total = scores.reduce((sum, value) => sum + value, 0);
  return Math.round(total / scores.length);
}

function buildCriticalIssues(results: TestResult[]) {
  const issues = new Map<string, { scores: Partial<Record<TestType, number>>; messages: string[]; recommendation?: string }>();

  for (const result of results) {
    const score = typeof result.score === 'number' ? result.score : result.passed ? 100 : 0;
    if (score >= 50) {
      continue;
    }

    const key = result.targetElement || result.testName;
    if (!issues.has(key)) {
      issues.set(key, { scores: {}, messages: [] });
    }
    const entry = issues.get(key)!;
    entry.scores[result.type] = score;
    entry.messages.push(`${result.testName} scored ${score}`);

    if (result.type === 'static-analysis' && result.data?.suggestions?.length) {
      entry.recommendation = result.data.suggestions.join('; ');
    }
  }

  return Array.from(issues.entries()).map(([element, value]) => ({
    element,
    scores: value.scores,
    summary: value.messages.join(' | '),
    recommendation: value.recommendation || 'Review the implementation and naming for clarity.',
  }));
}
