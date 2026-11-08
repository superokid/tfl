# Prompts

Sample of prompts used (Claude Code), with corrections.

## 2026-11-08: plan review
- "review the plan, any bad or need improve" + the brief.
  - Checked against the live API. Found:
    - the Cable Car has no predictions (false alarms)
    - D1 counts toward the 50-subrequest limit
    - prediction horizon is shorter than the window
    - React exceeds a 50 KB budget
  - Spec was fixed.
- "there are too many unnecessary written, just keep your writing minimal": docs cut by about half.
