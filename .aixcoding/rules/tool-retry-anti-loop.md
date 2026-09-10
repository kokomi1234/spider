# Tool Retry Anti-Loop Rule — 工具重试防复读

## Problem

When a tool call doesn't produce the expected result, LLM agents tend to **repeat the same tool call with nearly identical parameters**, as if "trying again will somehow work differently." This creates infinite loops (the "repeater" bug) that waste tokens and frustrate users.

## Root Cause

1. LLMs lack **meta-cognition** — they don't track "I already tried this approach"
2. They have no **failure strategy switching** mechanism
3. No explicit instruction to "change tactics after N failed attempts"

## Rules

### 1. Maximum 2 Attempts Per Tool Type

For any given tool (`grep_search`, `grep_search`, `read_file`, `run_terminal_command`, etc.):

- **First attempt**: Call the tool with your best guess
- **If unsatisfied with result**: You MUST change your approach before trying again
- **Maximum 2 attempts total** per tool type per problem

```
❌ BAD: grep_search("foo") → not enough → grep_search("foo") → not enough → grep_search("foo")
✅ GOOD: grep_search("foo") → not enough → run_terminal_command("grep -r 'foo' .") → done
```

### 2. Mandatory Strategy Switch

After the first failed attempt, you MUST switch to a **different tool or different approach**:

| If first attempt was | Switch to |
|---------------------|-----------|
| `grep_search` | `run_terminal_command` with native `grep` / `rg` |
| `read_file` on wrong path | `ls` / `file_glob_search` to verify path, then `read_file` |
| `file_glob_search` too broad | `grep_search` with specific pattern |
| `run_terminal_command` failed | Read error output, fix command, retry once |
| Any tool | `view_diff` / `read_currently_open_file` for context |

### 3. Self-Awareness Check

Before each tool call, ask yourself:
- "Have I tried this exact approach before?"
- "If yes, what will be DIFFERENT this time?"
- "If I can't answer 'different', DON'T call the tool — use a different approach instead"

### 4. Escalation After 2 Failures

If both attempts fail:
1. **Stop** — do NOT try a third time
2. **Explain** to the user what you tried and why it didn't work
3. **Ask** the user for guidance or alternative approach
4. **Suggest** a manual workaround if applicable

## Examples

### Bad: Infinite grep loop
```
User: Find where judgeEmptyHint is used
AI: grep_search("judgeEmptyHint")  ← result shows 2 matches
AI: grep_search("judgeEmptyHint")  ← still only 2 matches??
AI: grep_search("judgeEmptyHint")  ← still same??
... (infinite loop)
```

### Good: Strategy switch
```
User: Find where judgeEmptyHint is used
AI: grep_search("judgeEmptyHint")  ← got 2 results
AI: Not enough detail, let me use terminal grep for more context
AI: run_terminal_command("grep -rn 'judgeEmptyHint' ./publish/")  ← got line numbers + content
```

### Bad: Repeated read_file on wrong file
```
AI: read_file("src/main.py")  ← file not found
AI: read_file("src/main.py")  ← still not found??
AI: read_file("src/main.py")  ← ???
```

### Good: Verify then read
```
AI: read_file("src/main.py")  ← file not found
AI: ls("src/")  ← ah, the file is actually at "app/main.py"
AI: read_file("app/main.py")  ← success
```

## Key Principle

**Tools are means to an end, not ends themselves.** When one tool fails, change the means — don't repeat the same failing means expecting a different result. This is the AI equivalent of "insanity: doing the same thing over and over expecting different results."
