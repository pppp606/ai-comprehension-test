import { buildStaticAnalysisPrompt, buildStabilityPrompt, buildTestGenerationPrompt } from '../templates';
import { ClassInfo, GenerateOptions, MethodInfo, ProjectStructure, Test } from '../types';

let staticCounter = 0;
let stabilityCounter = 0;
let generationCounter = 0;

export class TestGenerator {
  constructor(private readonly structure: ProjectStructure, private readonly options: GenerateOptions) {}

  generate(): Test[] {
    const tests: Test[] = [];
    const allowedTypes = (process.env.AI_COMP_TEST_TYPES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allow = (t: 'static-analysis' | 'stability' | 'test-generation') =>
      allowedTypes.length === 0 || allowedTypes.includes(t);
    const shouldGenerateAll = this.options.hasFileSpecification;

    for (const cls of this.structure.classes) {
      if ((shouldGenerateAll || this.shouldTestStaticAnalysis(cls)) && allow('static-analysis')) {
        tests.push(this.createStaticAnalysisTestForClass(cls));

        for (const method of cls.methods) {
          if ((shouldGenerateAll || this.shouldTestStaticAnalysis(method)) && allow('static-analysis')) {
            tests.push(this.createStaticAnalysisTestForMethod(cls, method));
          }
        }
      }

      if ((shouldGenerateAll || this.shouldTestStability(cls)) && allow('stability')) {
        tests.push(this.createStabilityTestForClass(cls));
      }

      for (const method of cls.methods) {
        if ((shouldGenerateAll || this.shouldTestGeneration(method)) && allow('test-generation')) {
          tests.push(this.createTestGenerationTest(cls, method));
        }
      }
    }

    return tests;
  }

  private createStaticAnalysisTestForClass(cls: ClassInfo): Test {
    const id = `sa-${String(++staticCounter).padStart(3, '0')}`;
    const prompt = buildStaticAnalysisPrompt({
      elementType: 'Class',
      name: cls.name,
      code: cls.sourceCode,
    });
    return {
      id,
      type: 'static-analysis',
      name: `${cls.name} class naming`,
      prompt,
      targetElement: cls.name,
    };
  }

  private createStaticAnalysisTestForMethod(cls: ClassInfo, method: MethodInfo): Test {
    const id = `sa-${String(++staticCounter).padStart(3, '0')}`;
    const prompt = buildStaticAnalysisPrompt({
      elementType: 'Method',
      name: `${cls.name}.${method.name}`,
      code: method.sourceCode,
    });
    return {
      id,
      type: 'static-analysis',
      name: `${cls.name}.${method.name} method naming`,
      prompt,
      targetElement: `${cls.name}.${method.name}`,
    };
  }

  private createStabilityTestForClass(cls: ClassInfo): Test {
    const id = `stb-${String(++stabilityCounter).padStart(3, '0')}`;
    const question = `What is the primary responsibility of the ${cls.name} class?`;
    const prompt = buildStabilityPrompt({
      elementType: 'Class',
      name: cls.name,
      code: cls.sourceCode,
      question,
    });
    return {
      id,
      type: 'stability',
      name: `${cls.name} purpose consistency`,
      prompt,
      targetElement: cls.name,
      iterations: 3,
    };
  }

  private createTestGenerationTest(cls: ClassInfo, method: MethodInfo): Test {
    const id = `tg-${String(++generationCounter).padStart(3, '0')}`;
    const prompt = buildTestGenerationPrompt({
      className: cls.name,
      methodName: method.name,
      implementation: cls.sourceCode,
    });
    return {
      id,
      type: 'test-generation',
      name: `${cls.name}.${method.name} test generation`,
      prompt,
      targetElement: `${cls.name}.${method.name}`,
      // Persist the project-relative source file path to compute import path later
      sourceFilePath: cls.file,
    };
  }

  private shouldTestStaticAnalysis(element: ClassInfo | MethodInfo): boolean {
    if ((element as ClassInfo).methods !== undefined && (element as ClassInfo).methods !== null && 'file' in (element as any)) {
      const cls = element as ClassInfo;
      if (/(Service|Manager|Handler|Processor)$/i.test(cls.name)) {
        return true;
      }
      if (cls.methods.some((method) => this.methodNameIsGeneric(method.name))) {
        return true;
      }
      return false;
    }

    const method = element as MethodInfo;
    return this.methodNameIsGeneric(method.name);
  }

  private shouldTestStability(cls: ClassInfo): boolean {
    if (cls.methods.length <= 3 && /(Service|Manager)$/i.test(cls.name)) {
      return true;
    }
    return cls.methods.some((method) => this.methodNameIsGeneric(method.name));
  }

  private shouldTestGeneration(method: MethodInfo): boolean {
    return method.loc >= 10 && method.loc <= 50;
  }

  private methodNameIsGeneric(name: string): boolean {
    return /^(process|handle|execute|run)$/i.test(name);
  }
}
