# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`ai-comprehension-test` is a CLI tool that evaluates how easily an AI coding agent can understand a TypeScript codebase. It scans TypeScript files, generates comprehension tests, executes them through a local AI agent (like Claude or Codex), and produces detailed reports.

## Build, Test, and Development Commands

```bash
# Install dependencies
npm install

# Build the TypeScript project
npm run build

# Run in development mode (uses tsx for direct TS execution)
npm run dev -- run [project-path] [options]

# Run unit tests (uses Jest)
npm test

# Run the built CLI
npx ai-comprehension-test run [project-path] [options]
```

### Common CLI Options

- `--files "file1.ts,file2.ts"` - Limit scan to specific files
- `--output <dir>` - Output directory (defaults to `.ai-comp-test`)
- `--format <format>` - Output format: `console` or `json`
- `--verbose` - Enable detailed logging

### Environment Variables for AI Agent Configuration

- `AI_COMP_TEST_COMMAND` - AI agent command (default: `claude`)
- `AI_COMP_TEST_ARGS` - Arguments for the agent (default: `-p`)
- `AI_COMP_TEST_TIMEOUT` - Timeout in seconds (default: `180`)
- `AI_COMP_TEST_DEBUG` - Enable debug output (default: `false`)

## Architecture

### Core Execution Flow

1. **Scanning** (`TypeScriptScanner` in `src/scanner/`) - Uses TypeScript compiler API to parse files and extract classes, methods, functions with metadata (signature, LOC, parameters, etc.)
2. **Test Generation** (`TestGenerator` in `src/core/`) - Creates three types of tests based on heuristics:
   - **Static Analysis**: Evaluates naming clarity of classes/methods
   - **Stability**: Tests consistency of AI responses across multiple runs
   - **Test Generation**: Asks AI to generate Jest tests for methods
3. **Test Execution** (`TestRunner` in `src/core/`) - Orchestrates AI calls and Jest execution
4. **Reporting** (`src/reporter/`) - Formats results as console output or JSON

### Key Components

**AI Agent Client** (`src/core/ai-agent-client.ts`)
- Abstracts interaction with local AI CLI tools (claude, codex, etc.)
- Uses `spawn()` to execute commands and capture stdout/stderr
- Supports both stdin-based prompts (claude) and argument-based prompts (codex)

**Test Generator Heuristics** (`src/core/test-generator.ts`)
- Static analysis tests: Generated for classes ending in Service/Manager/Handler/Processor OR methods with generic names (process, handle, execute, run)
- Stability tests: Generated for small classes (≤3 methods) named Service/Manager OR classes with generic method names
- Test generation: Generated for methods with 10-50 lines of code
- When `--files` is specified, all heuristics are bypassed and tests are generated for everything

**Test Runner** (`src/core/test-runner.ts`)
- Static analysis: Single AI call, expects JSON response with `nameAccuracy`, `clarity`, `nameAccuracyScore`
- Stability: Multiple AI calls (default 5 iterations), followed by a judgment call to analyze consistency
- Test generation: Single AI call to generate Jest code, writes to temp file, executes via JestRunner
- JSON parsing: Robust fallback logic handles markdown code blocks and raw JSON objects

**TypeScript Scanner** (`src/scanner/typescript-scanner.ts`)
- Recursively scans directories, ignoring `node_modules`, `dist`, `build`, `.git`, `.ai-comp-test`
- Extracts class/method/function metadata using TypeScript AST visitor pattern
- Calculates LOC by counting non-empty lines

**Prompt Templates** (`src/templates/`)
- Separated into individual modules: `static-analysis.ts`, `stability.ts`, `stability-judgment.ts`, `test-generation.ts`
- All expect structured JSON responses from AI
- Test generation prompts expect valid Jest/TypeScript test code

### Data Flow

```
CLI Entry (src/cli/index.ts)
  ↓
Run Command (src/cli/run.ts)
  ↓
TypeScriptScanner.scan() → ProjectStructure
  ↓
TestGenerator.generate() → Test[]
  ↓
TestRunner.run() → TestResult[]
  ├─ AIAgentClient.call() for prompts
  └─ JestRunner.run() for test execution
  ↓
Reporter (console or JSON) → Output
```

### Type System

All core types are defined in `src/types/index.ts`:
- `ProjectStructure`: Output of scanning phase
- `Test`: Test definition with prompt and metadata
- `TestResult`: Base result type with discriminated union for static-analysis, stability, test-generation
- `ClassInfo`, `MethodInfo`, `FunctionInfo`: Scanned code metadata

## Testing Strategy

When writing tests:
- Unit tests go in `src/*/___tests__/` directories
- Use vitest as the test runner
- Mock `AIAgentClient` and `JestRunner` for isolated unit tests
- For integration tests, use small fixture TypeScript files

## Notes

- The tool expects `jest` and `ts-jest` to be available when running test-generation tests
- TypeScript compilation targets ES2019 with CommonJS modules
- All file paths should be resolved to absolute paths internally
- The scanner ignores `.d.ts` files and only processes `.ts` files
