export type TestType = 'static-analysis' | 'stability' | 'test-generation';

export interface Test {
  id: string;
  type: TestType;
  name: string;
  prompt: string;
  targetElement: string;
  iterations?: number;
  // Optional: absolute or project-relative path to the source file under test
  // Used by the test-generation runner to compute correct import paths
  sourceFilePath?: string;
}

export interface TestResult {
  testId: string;
  testName: string;
  type: TestType;
  passed: boolean;
  targetElement?: string;
  score?: number;
  data?: any;
  error?: string;
  executedAt: Date;
  executionTimeMs?: number;
}

export interface StaticAnalysisResult extends TestResult {
  type: 'static-analysis';
  data: {
    nameAccuracy: boolean;
    nameAccuracyScore: number;
    issues: string[];
    suggestions: string[];
    clarity: 'HIGH' | 'MEDIUM' | 'LOW';
    reasoning: string;
  };
}

export interface StabilityResult extends TestResult {
  type: 'stability';
  data: {
    responses: string[];
    consistencyScore: number;
    consistencyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    mainIdea: string;
    variations: Array<{
      aspect: string;
      values: string[];
      frequency: number;
    }>;
    reasoning: string;
    codeClarity: 'CLEAR' | 'AMBIGUOUS' | 'MISLEADING';
  };
}

export interface TestGenerationResult extends TestResult {
  type: 'test-generation';
  data: {
    generatedTest: string;
    jestOutput: string;
    errorAnalysis?: {
      expectedCalls: string[];
      actualCalls: string[];
      summary: string;
    };
  };
}

export interface CriticalIssue {
  element: string;
  scores: Partial<Record<TestType, number>>;
  summary: string;
  recommendation: string;
}

export interface TestResults {
  summary: {
    projectPath: string;
    filesSpecified?: string[];
    executedAt: string;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    overallScore: number;
    executionTimeMs: number;
  };
  byTestType: Record<TestType, {
    total: number;
    passed: number;
    failed: number;
    averageScore: number;
  }>;
  results: TestResult[];
  criticalIssues: CriticalIssue[];
}

export interface ParameterInfo {
  name: string;
  type: string;
  isOptional: boolean;
}

export interface MethodInfo {
  name: string;
  sourceCode: string;
  signature: string;
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
  loc: number;
}

export interface PropertyInfo {
  name: string;
  type: string;
  isReadonly: boolean;
  isPrivate: boolean;
}

export interface ClassInfo {
  name: string;
  file: string;
  sourceCode: string;
  methods: MethodInfo[];
  properties: PropertyInfo[];
  loc: number;
  isExported: boolean;
}

export interface FunctionInfo {
  name: string;
  file: string;
  sourceCode: string;
  signature: string;
  loc: number;
}

export interface ProjectStructure {
  classes: ClassInfo[];
  functions: FunctionInfo[];
  totalFiles: number;
  scannedFiles: string[];
  scannedAt: Date;
}

export interface ScanOptions {
  projectPath: string;
  files?: string[];
}

export interface GenerateOptions {
  hasFileSpecification: boolean;
}

export interface ExecOptions {
  input?: string;
  cwd?: string;
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface AIAgentConfig {
  command: string;
  args: string[];
  workingDir: string;
  timeout: number;
}

export interface CallOptions {
  timeout?: number;
  workingDir?: string;
}
