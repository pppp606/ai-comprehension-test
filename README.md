# AI Comprehension Test

`ai-comprehension-test` is a CLI tool that evaluates how easily an AI coding agent (such as Claude Code or Codex) can understand a TypeScript codebase. The tool scans selected project files, generates AI-driven comprehension tests, executes them through a local AI agent, and summarizes the findings in either a console or JSON report.

Important: the goal is not to “make tests pass”, but to detect whether the code is easy for an AI to read accurately. Reports focus on grounded, code-backed signals rather than pure prompt compliance.

## Key Features

- **Automated project scanning** – analyzes classes, methods, and functions in your TypeScript project.
- **Multiple comprehension test types** – static analysis, stability checks (local, deterministic scoring), and AI-generated Jest tests.
- **Groundedness (AST-based)** – extracts reference facts from code (defaults/limits/normalization/constants) and compares them to the LLM’s MR to assess factual alignment.
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

You can configure how the CLI invokes the AI agent and the evaluation behavior via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_COMP_TEST_COMMAND` | Command used to call the AI agent. | `claude` |
| `AI_COMP_TEST_ARGS` | Arguments passed to the AI agent command. | `-p` |
| `AI_COMP_TEST_TIMEOUT` | Timeout in seconds for AI calls. | `180` |
| `AI_COMP_TEST_DEBUG` | Enable verbose debugging output (`true` / `false`). | `false` |
| `AI_COMP_TEST_TYPES` | Comma-separated test types to run: `static-analysis,stability,test-generation`. | (all) |
| `AI_COMP_TEST_STABILITY_ITER` | Number of responses per stability test (low for faster runs). | `5` |
| `AI_COMP_TEST_STABILITY_PROMPT_MODE` | `gamified` to enable +1/0/−1 scoring rule in prompts. | (off) |
| `AI_COMP_TEST_INCLUDE_SCHEMA` | `1` to include JSON Schema and example in prompts. | `1` |
| `AI_COMP_TEST_RECOMPUTE_COVERAGE` | `1` to recompute coverage metrics from MR in the runner. | (off) |
| `AI_COMP_TEST_AMBIGUITY` | `model|hybrid` to enable Transformers.js ambiguity detector. | (off) |
| `AI_COMP_TEST_AMBIGUITY_MODEL` | ZSC model id (e.g., `Xenova/distilbert-base-uncased-mnli`). | (default) |
| `AI_COMP_TEST_INCLUDE_AMBIGUITY_IN_SCORE` | `1` to blend model specificity into stability score. | (off) |
| `AI_COMP_TEST_AMBIGUITY_WEIGHT` | Blend weight (0–0.5). | `0.15` |

For example, to run against Codex:

```bash
export AI_COMP_TEST_COMMAND=codex
export AI_COMP_TEST_ARGS="exec"
```

### Using .env

This CLI loads environment variables from a `.env` file in the current working directory. An example template is provided as `.env.example`.

Example `.env`:

```
AI_COMP_TEST_COMMAND=claude
AI_COMP_TEST_ARGS=-p
AI_COMP_TEST_TIMEOUT=180
# AI_COMP_TEST_WORKDIR=/absolute/path/to/workdir
```

Notes:
- `AI_COMP_TEST_ARGS` is split by spaces. Prefer `--flag=value` for values containing spaces.
- Shell environment variables override values from `.env`.
- The `.env` file should be placed in the directory where you run the CLI.

## Usage

The CLI exposes a single `run` command. Invoke it from the root of the project you want to analyze:

```bash
npx ai-comprehension-test run [project-path]
```

### Options

- `--files <files>` – Comma-separated list of files to limit the scan, e.g. `--files "src/UserService.ts,src/PaymentService.ts"`.
- `--output <dir>` – Directory for generated artifacts (defaults to `.ai-comp-test`).
- `--format <format>` – Output format: `console` (default) or `json`.
- `--json-file <file>` – When `--format json`, the output filename (default: `results.json`).
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
- **JSON report** – Structured machine-readable output saved to `<output>/results.json` (or `--json-file`) when `--format json` is specified.

## Stability and Groundedness

### Stability (consistency)
Stability judgment is local and deterministic:
- Parses each MR response (with code‑fence and loose-object recovery).
- Vectorizes per-field text using TF‑IDF; computes average pairwise cosine similarity per field; aggregates to a 0–100 `consistencyScore` and `consistencyLevel`.
- Derives `mainIdea`, `variations`, `reasoning`, and `codeClarity`.
- Optional: embedding/ZSC ambiguity integration via `@xenova/transformers`.

### Groundedness (fact alignment)
The runner extracts a Reference MR from code via AST and compares it to the LLM MR:
- Extracts defaults (`this.x=…`, `??`), limits (nested `Math.min/max`), normalization (s→ms), and constants.
- Computes `groundedness.score = factCoverage` (0–100) and lists `mismatches`.
- Recomputes `coverage.schemaCoverage/specificity` from the parsed MR to avoid under-reporting.

This makes “AI comprehension” observable as factual alignment to code, not only prompt adherence.

### Prompt Schema and Example
Prompts include the full MR schema (see `schemas/mr.schema.json`) and a concrete example. Keys must be present even when unknown; do not guess—use `unknowns` with reasons. Ambiguous language is disallowed.

This removes one LLM call from the Stability flow and improves reproducibility.

### Embedding Mode (Optional)

You can switch to an embedding-based scorer for better synonym/phrasing robustness:

- Set `AI_COMP_TEST_STABILITY_MODE=embedding`
- Optional: `AI_COMP_TEST_EMBED_MODEL` to override the default `Xenova/all-mpnet-base-v2`.
- On first run, the model is downloaded (network required). Subsequent runs are cached.

The embedding scorer creates sentence embeddings per field using `@xenova/transformers` (mean pooled) and uses pairwise cosine similarity, then aggregates like the default mode.

Notes:
- Default embedding model: `Xenova/all-mpnet-base-v2` (higher accuracy; heavier).
- Lighter alternative: `Xenova/all-MiniLM-L6-v2` (faster; slightly lower accuracy).

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
