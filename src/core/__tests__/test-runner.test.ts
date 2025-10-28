import type { AIAgentClient } from '../ai-agent-client';
import type { JestRunner } from '../jest-runner';
import { TestRunner } from '../test-runner';
import type { Test } from '../../types';

describe('TestRunner helpers', () => {
  const agent = { call: jest.fn() } as unknown as AIAgentClient;
  const jestRunner = { run: jest.fn() } as unknown as JestRunner;
  const runner = new TestRunner(agent, jestRunner, {
    projectPath: '/repo',
    outputDir: '/repo/.ai-comp-test',
  });

  describe('parseJson', () => {
    it('parses plain JSON strings', () => {
      const parsed = (runner as any).parseJson('{"value": 42}', 'test-1');
      expect(parsed).toEqual({ value: 42 });
    });

    it('parses JSON enclosed in code fences', () => {
      const parsed = (runner as any).parseJson('```json\n{"result": true}\n```', 'test-2');
      expect(parsed).toEqual({ result: true });
    });

    it('throws when JSON cannot be recovered', () => {
      expect(() => (runner as any).parseJson('not json', 'test-3')).toThrow(
        'Failed to parse AI output for test-3',
      );
    });
  });

  it('extracts question text from prompt', () => {
    const prompt = [
      '## Question',
      '',
      'What does this method do?',
      '',
      'Respond with 2-3 sentences describing what you understand.',
    ].join('\n');
    const question = (runner as any).extractQuestion(prompt);
    expect(question).toBe('What does this method do?');
  });

  it('extracts code block from prompt', () => {
    const prompt = '```typescript\nclass Test {}\n```';
    const code = (runner as any).extractCode(prompt);
    expect(code).toBe('class Test {}');
  });

  it('summarises jest output for failures', () => {
    const output = 'Expected mockFn to have been called\nReceived:\nExpected anotherMock to have been called';
    const analysis = (runner as any).analyzeJestError(output);
    expect(analysis.summary).toContain('Mock expectations');
    expect(analysis.expectedCalls).toEqual(['mockFn', 'anotherMock']);
    expect(analysis.actualCalls).toEqual(['Received count: 1']);
  });
});

describe('TestRunner run', () => {
  it('returns failure result when underlying execution throws', async () => {
    const agent = {
      call: jest.fn().mockResolvedValue('{"nameAccuracy": false, "clarity": "LOW"}'),
    } as unknown as AIAgentClient;

    const jestRunner = {
      run: jest.fn().mockResolvedValue({ passed: true, output: 'ok', testResults: [] }),
    } as unknown as JestRunner;

    const runner = new TestRunner(agent, jestRunner, {
      projectPath: '/repo',
      outputDir: '/repo/.ai-comp-test',
    });

    const tests: Test[] = [
      {
        id: 'sa-001',
        name: 'Class naming',
        type: 'static-analysis',
        prompt: '{"nameAccuracy": false}',
        targetElement: 'Example',
      },
    ];

    const results = await runner.run(tests);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('static-analysis');
    expect(results[0].passed).toBe(false);
  });
});
