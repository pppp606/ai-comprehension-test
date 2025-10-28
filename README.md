# AI Comprehension Test

`ai-comprehension-test` is a CLI tool that evaluates how easily an AI coding agent (such as Claude Code or Codex) can understand a TypeScript codebase. The tool scans selected project files, generates AI-driven comprehension tests, executes them through a local AI agent, and summarizes the findings in either a console or JSON report.

## Key Features

- **Automated project scanning** – analyzes classes, methods, and functions in your TypeScript project.
- **Multiple comprehension test types** – static analysis, stability checks, and AI-generated Jest tests.
- **AI agent orchestration** – prompts a local Claude Code or Codex instance and parses structured responses.
- **Detailed reporting** – view friendly console summaries or machine-readable JSON output with actionable insights.

## Prerequisites

- Node.js v18 or later
- npm v9 or later
- A local AI agent binary available on your `PATH` (Claude Code or Codex)
- Optional: `claude` CLI with the `-p` flag or `codex exec`

If you plan to run test-generation suites, ensure `jest` and `ts-jest` dependencies are installed (they are listed in `package.json`).

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/ai-comprehension-test.git
cd ai-comprehension-test
npm install
```

Build the CLI:

```bash
npm run build
```

## Environment Configuration

You can configure how the CLI invokes the AI agent via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_COMP_TEST_COMMAND` | Command used to call the AI agent. | `claude` |
| `AI_COMP_TEST_ARGS` | Arguments passed to the AI agent command. | `-p` |
| `AI_COMP_TEST_TIMEOUT` | Timeout in seconds for AI calls. | `60` |
| `AI_COMP_TEST_DEBUG` | Enable verbose debugging output (`true` / `false`). | `false` |

For example, to run against Codex:

```bash
export AI_COMP_TEST_COMMAND=codex
export AI_COMP_TEST_ARGS="exec"
```

## Usage

The CLI exposes a single `run` command. Invoke it from the root of the project you want to analyze:

```bash
npx ai-comprehension-test run [project-path]
```

### Options

- `--files <files>` – Comma-separated list of files to limit the scan, e.g. `--files "src/UserService.ts,src/PaymentService.ts"`.
- `--output <dir>` – Directory for generated artifacts (defaults to `.ai-comp-test`).
- `--format <format>` – Output format: `console` (default) or `json`.
- `--verbose` – Print detailed logs during scanning, AI calls, and reporting.
- `--help` – Display help information.

### Examples

Run the full suite against the current project:

```bash
npx ai-comprehension-test run
```

Analyze a subset of files and produce a JSON report:

```bash
npx ai-comprehension-test run \
  --files "src/services/UserService.ts" \
  --format json \
  --output ./results \
  --verbose
```

Execute against another project directory:

```bash
npx ai-comprehension-test run ../another-project
```

### Output

- **Console report** – Summaries, tables of test outcomes, and highlighted critical issues.
- **JSON report** – Structured machine-readable output saved to `<output>/results.json` when `--format json` is specified.

## Development Workflow

Start the CLI in development mode with `tsx`:

```bash
npm run dev -- run --help
```

Run TypeScript compilation checks:

```bash
npm run build
```

Execute unit tests (if present, with Jest):

```bash
npm test
```

> **Note:** Initial dependency installation may require network access to fetch packages such as `@types/jest`.

## Project Structure

```
ai-comprehension-test/
├── src/
│   ├── cli/                # CLI entry point and command wiring
│   ├── core/               # AI agent client, test generation, and runners
│   ├── reporter/           # Console and JSON reporters
│   ├── scanner/            # TypeScript AST scanner and type definitions
│   ├── templates/          # Prompt templates for each test type
│   └── types/              # Shared TypeScript interfaces
├── jest.config.js          # Jest configuration for generated tests
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── README.md               # Project documentation
```

## Troubleshooting

- **AI command not found:** Ensure `claude` or `codex` is installed locally and available on your `PATH`.
- **Timeouts during AI calls:** Increase `AI_COMP_TEST_TIMEOUT` or verify that the agent is responsive.
- **Jest test failures:** Review the generated test files in the output directory and rerun with `--verbose` for additional logs.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
