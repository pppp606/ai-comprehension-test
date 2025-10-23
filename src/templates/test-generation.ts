interface TestGenerationTemplateOptions {
  className: string;
  methodName: string;
  implementation: string;
}

export function buildTestGenerationPrompt(options: TestGenerationTemplateOptions): string {
  const { className, methodName, implementation } = options;
  return [
    'You have access to the entire project codebase as context.',
    '',
    'Generate a complete, self-contained Jest test file for this method.',
    '',
    '## Target Method',
    '',
    `Class: ${className}`,
    `Method: ${methodName}`,
    '',
    '## Implementation',
    '',
    '```typescript',
    implementation,
    '```',
    '',
    '## Requirements',
    '',
    '1. Create a complete test file that can run independently',
    '2. Define all necessary types inline (Database, Logger, etc.)',
    '3. Include the implementation code in the test file',
    '4. Mock all dependencies appropriately',
    '5. Test the main behavior and edge cases',
    '6. Use standard Jest syntax',
    '',
    '## Output Format',
    '',
    'Return ONLY the complete TypeScript test file code. Start with type definitions, then implementation, then tests. Do not include explanations, markdown formatting, or code fences. Just the raw TypeScript code.'
  ].join('\n');
}
