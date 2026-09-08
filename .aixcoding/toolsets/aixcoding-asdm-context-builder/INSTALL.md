# ASDM Context Builder Installation

**Toolset ID:** `asdm-context-builder`

## Overview
This document provides instructions for installing and setting up the ASDM Context Builder toolset. This toolset helps AI agents build project-specific context for the application — scanning codebase structure, generating structured documentation in L1/L2 format, and maintaining context accuracy through incremental updates and validation.

## AI Guided Installation
To install this toolset using AI Guided Installation, copy and paste the following prompt into your AI coding tool's chat window:

```shell
Follow instructions in .aixcoding/toolsets/aixcoding-asdm-context-builder/INSTALL.md
```

## Installation Steps

### 1. Create `.aixcoding/toolsets` and `.aixcoding/contexts` directories

Create directories for storing toolsets and generated context files:

```bash
mkdir -p .aixcoding/toolsets
mkdir -p .aixcoding/contexts/layer-2
mkdir -p .aixcoding/workspace/asdm-context/validation-reports
```

### 2. Detect the current `Agentic Engine` provider

Detect the current AI coding assistant provider. Using the following guidelines to detect the provider:

- If `.aixcoding` directory exists, use `AIxCoding`
- If no such folder is found in the current workspace, give user a prompt to select a provider manually

### 3. Create shortcut commands for ASDM Context Builder (toolset ID: `asdm-context-builder`) in provider's entry point

> **Design Principle**: Command files should be **direct copies** of the actual action files under `.aixcoding/toolsets/aixcoding-asdm-context-builder/actions/` (using `cp`), rather than thin references (`follow`). This way each command file is the full action instruction and does not rely on file tools reading a virtual directory.

#### For AIxCoding (`.aixcoding/commands/`):

AIxCoding uses Markdown command files with YAML frontmatter, and supports `$ARGUMENTS` placeholders for passing arguments:

```bash
mkdir -p .aixcoding/commands/

# Initialize context command
cp .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-init.md .aixcoding/commands/asdm-context-init.md

# Update context command
cp .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-update.md .aixcoding/commands/asdm-context-update.md

# Validate context command
cp .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-validate.md .aixcoding/commands/asdm-context-validate.md
```

> **Note**: AIxCoding also supports defining commands directly in `opencode.json` via the `command` key with equivalent format.

### 4. Manual Usage for Other Providers

If your AI coding assistant provider is not detected by the automatic detection logic (or is AIxCoding), you can still use the ASDM Context Builder manually. Follow these steps:

#### Direct Instruction Usage
You can directly use the instruction files by copying their relative paths and pasting them into your AI coding assistant's chat window:

1. **Navigate to the instruction files**:
   ```bash
   cd .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/
   ```

2. **Right-click on the desired instruction file** and copy its relative path:
   - For initializing context: `asdm-context-init.md`
   - For updating context: `asdm-context-update.md`
   - For validating context: `asdm-context-validate.md`

3. **Enter a prompt** in your AI coding assistant:
   ```
   follow {relative path to instruction file}
   ```
   Example: `follow .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-init.md`

## Using ASDM Context Builder

### Step 1: Initialize Project Context (First Time / Rebuild)

Generate complete L1/L2 context structure by scanning the entire project:

```shell
/asdm-context-init
```

This will:
1. Scan backend, frontend, deployment directories
2. Extract service list (modules), tech stack, coding style, data models, API endpoints, architecture decisions, deployment configs
3. Generate L1 entry file: `.aixcoding/contexts/index.md`
4. Generate L2 detail files under `.aixcoding/contexts/layer-2/` (6 spec documents)
5. Store scan cache at `.aixcoding/workspace/asdm-context/scan-cache.json`

**Use this when**: First time setup, or when you need to rebuild context from scratch

### Step 2: Update Context Incrementally

After code changes, update affected context files to stay in sync:

```shell
/asdm-context-update [scope]
```

This will:
1. Detect changes (via git diff, specified scope, or full scan mode)
2. Identify which context sections are affected
3. Update only the relevant L2 files
4. Regenerate L1 index if needed
5. Produce a change summary report

**Use this when**: After an iteration release, major refactoring, or periodic maintenance

### Step 3: Validate Context Accuracy

Check if existing context files match the actual codebase:

```shell
/asdm-context-validate
```

This will:
1. Compare each context section against actual source code
2. Flag stale items, inconsistencies, and missing information
3. Generate a validation report with diagnostic findings
4. Save report to `.aixcoding/workspace/asdm-context/validation-reports/validation-{date}.md`

**Use this when**: AI assistance behaves unexpectedly, or during regular quality audits

### Available Commands
Once installed, you can use the following commands:

| Command | Description |
|---------|-------------|
| `/asdm-context-init` | Initialize project context (first time or rebuild) |
| `/asdm-context-update [scope]` | Incrementally update context (scope optional, supports full mode) |
| `/asdm-context-validate` | Validate existing context accuracy |

### Recommended Workflow

```shell
# First-time setup or rebuild
/asdm-context-init

# After each iteration release
/asdm-context-update

# When AI assistance seems off
/asdm-context-validate

# Weekly quality audit
/asdm-context-validate
```

## Context Output Structure

ASDM Context Builder generates context files in a two-layer (L1/L2) structure:

```
.aixcoding/
├── contexts/                              # Project context knowledge base
│   ├── index.md                           # ★ L1 Entry file (must-read)
│   │                                       #    — Global overview, navigation index, dev guide
│   └── layer-2/                           # L2 Detailed context
│       ├── standard-project-structure.md  # Standard project structure & organization
│       ├── standard-coding-style.md       # Coding standards & style guide
│       ├── data-models.md                 # Data models, relationships & data flow
│       ├── api.md                         # API interface definitions & docs
│       ├── architecture.md                # System architecture & technical decisions
│       └── deployment.md                  # Deployment configuration & procedures
└── workspace/
    └── asdm-context/                      # Toolset runtime workspace
        ├── scan-cache.json               # Scan result cache
        └── validation-reports/           # Historical validation reports
            └── validation-{date}.md
```

## Toolset Structure

The ASDM Context Builder toolset has the following structure:

```
.aixcoding/toolsets/aixcoding-asdm-context-builder/
├── README.md                              ## Toolset description
├── INSTALL.md                             ## Installation instructions (this file)
├── manifest.json                          ## Toolset manifest
├── actions/                               ## Action instruction files
│   ├── asdm-context-init.md               ## Initialize project context (L1/L2)
│   ├── asdm-context-update.md             ## Incrementally update context
│   └── asdm-context-validate.md           ## Validate context accuracy
├── specs/                                 ## Spec templates (reference only)
│   ├── layer-1/
│   │   └── index.md                       ## L1 entry template
│   └── layer-2/
│       ├── standard-project-structure.md  ## Project structure template
│       ├── standard-coding-style.md       ## Coding style template
│       ├── data-models.md                 ## Data model template
│       ├── api.md                         ## API doc template
│       ├── architecture.md                ## Architecture template
│       └── deployment.md                  ## Deployment config template
└── docs/                                  ## Extended docs (reserved)
```

## Verification

After installation, verify that:

1. The `.aixcoding/contexts/` directory exists (with `layer-2/` subdirectory)
2. The `.aixcoding/workspace/asdm-context/` runtime workspace exists
3. Shortcut commands for ASDM Context Builder are created in the appropriate provider directory:
   - **AIxCoding**: `.aixcoding/commands/asdm-context-init.md`, `asdm-context-update.md`, `asdm-context-validate.md`
4. Each command file is a **direct copy** of the corresponding action file (`cp .aixcoding/toolsets/aixcoding-asdm-context-builder/actions/<action>.md .aixcoding/commands/<action>.md`) rather than a thin reference (`follow`)
5. The ASDM Context Builder toolset files are located in `.aixcoding/toolsets/aixcoding-asdm-context-builder` (toolset ID: `asdm-context-builder`)

**For other providers**: Verify that you can access the instruction files at:
- `.aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-init.md`
- `.aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-update.md`
- `.aixcoding/toolsets/aixcoding-asdm-context-builder/actions/asdm-context-validate.md`

## Notes

- This installation process assumes you have the necessary permissions to create directories and files
- Command files are **direct copies** (`cp`) of the action files, so action file updates require re-copying the command to take effect
- The generated context files (`.aixcoding/contexts/`) are derived from **spec templates** in `specs/` — AI scans actual code and fills placeholders before output
- Context validation should be run periodically to ensure accuracy as the codebase evolves
- The `specs/` directory contains reference templates marked with template declarations; they are **not** the final context output
- All generated context follows ASDM design principles and the L1/L2 layered architecture pattern
- You can re-run `/asdm-context-init` anytime to rebuild context from scratch (overwrites existing)

## Integration with ASDM

ASDM Context Builder follows ASDM design principles and integrates with the existing ASDM ecosystem:
- Follows the standard toolset directory structure
- Uses the same action and spec conventions
- Supports the AIxCoding AI coding assistant
- Generates installation instructions compatible with ASDM
- Outputs context to the standard `.aixcoding/contexts/` location

### Getting Help
For issues with ASDM Context Builder, refer to:
- [ASDM Documentation](https://asdm.ai/docs)
- Toolset README: `.aixcoding/toolsets/aixcoding-asdm-context-builder/README.md`
- ASDM Design Principles: `.aixcoding/toolsets/toolset-builder/specs/ASDM_TOOLSET_DESIGN_PRINCIPLES.md`
- Toolset Development Training: `.aixcoding/toolsets/toolset-builder/specs/TOOLSET_DEV_TRAINING.md`

## License
Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.

---

*This installation document is part of the ASDM Context Builder toolset. Use this toolset to maintain accurate AI-friendly context for the project.*
