import { describe, it, expect } from 'vitest';
import { TestGenerator } from '../test-generator';
import type { GenerateOptions, MethodInfo, ProjectStructure } from '../../types';

describe('TestGenerator', () => {
  it('generates tests according to heuristics when no file filter is provided', () => {
    const methods: MethodInfo[] = [
      {
        name: 'process',
        sourceCode: 'async process(userId: string) { return userId; }',
        signature: 'process(userId: string)',
        parameters: [
          { name: 'userId', type: 'string', isOptional: false },
        ],
        returnType: 'Promise<string>',
        isAsync: true,
        isStatic: false,
        loc: 12,
      },
      {
        name: 'handle',
        sourceCode: 'handle(event: string) { return event; }',
        signature: 'handle(event: string)',
        parameters: [
          { name: 'event', type: 'string', isOptional: false },
        ],
        returnType: 'string',
        isAsync: false,
        isStatic: false,
        loc: 18,
      },
    ];

    const structure: ProjectStructure = {
      classes: [
        {
          name: 'UserService',
          file: '/repo/src/user-service.ts',
          sourceCode: 'class UserService { /* ... */ }',
          methods,
          properties: [],
          loc: 30,
          isExported: true,
        },
        {
          name: 'UtilityHelper',
          file: '/repo/src/util.ts',
          sourceCode: 'class UtilityHelper { calculate() {} }',
          methods: [
            {
              name: 'calculate',
              sourceCode: 'calculate(value: number) { return value * 2; }',
              signature: 'calculate(value: number)',
              parameters: [
                { name: 'value', type: 'number', isOptional: false },
              ],
              returnType: 'number',
              isAsync: false,
              isStatic: false,
              loc: 20,
            },
          ],
          properties: [],
          loc: 10,
          isExported: true,
        },
      ],
      functions: [],
      totalFiles: 1,
      scannedFiles: ['/repo/src/user-service.ts'],
      scannedAt: new Date(),
    };

    const options: GenerateOptions = {
      hasFileSpecification: false,
    };

    const generator = new TestGenerator(structure, options);
    const tests = generator.generate();

    const staticAnalysisTests = tests.filter((test) => test.type === 'static-analysis');
    const stabilityTests = tests.filter((test) => test.type === 'stability');
    const generationTests = tests.filter((test) => test.type === 'test-generation');

    expect(staticAnalysisTests.map((test) => test.targetElement)).toEqual([
      'UserService',
      'UserService.process',
      'UserService.handle',
    ]);
    expect(stabilityTests.map((test) => test.targetElement)).toEqual(['UserService']);
    expect(generationTests.map((test) => test.targetElement)).toEqual([
      'UserService.process',
      'UserService.handle',
      'UtilityHelper.calculate',
    ]);

    const ids = tests.map((test) => test.id);
    expect(new Set(ids).size).toBe(tests.length);
  });

  it('generates tests for all elements when files are specified', () => {
    const structure: ProjectStructure = {
      classes: [
        {
          name: 'PaymentManager',
          file: '/repo/payment.ts',
          sourceCode: 'class PaymentManager { execute() {} }',
          methods: [
            {
              name: 'execute',
              sourceCode: 'execute() { return true; }',
              signature: 'execute()',
              parameters: [],
              returnType: 'boolean',
              isAsync: false,
              isStatic: false,
              loc: 15,
            },
          ],
          properties: [],
          loc: 15,
          isExported: true,
        },
      ],
      functions: [],
      totalFiles: 1,
      scannedFiles: ['/repo/payment.ts'],
      scannedAt: new Date(),
    };

    const options: GenerateOptions = {
      hasFileSpecification: true,
    };

    const generator = new TestGenerator(structure, options);
    const tests = generator.generate();

    expect(tests).toHaveLength(4);
    expect(tests.every((test) => test.targetElement.includes('PaymentManager'))).toBe(true);
  });
});
