## Required context order

Before answering codebase questions or changing files:

1. Read `docs/PROJECT_CONTEXT.md`.
2. Use its routing table to read only the section relevant to the current task, including the
   universal guardrails at the top.
3. Then use Graphify to query relationships or paths when the task benefits from graph context.

`docs/PROJECT_CONTEXT.md` is the first context entry point. Graphify supplements that document; it
does not replace or precede it.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, first read `docs/PROJECT_CONTEXT.md`, then use the installed
graphify skill or instructions.

Rules:
- For codebase questions, after reading the routed project context, run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
