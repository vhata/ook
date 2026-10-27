# Acceptance

This project does not tag releases. Acceptance criteria are tracked at the milestone level in `FEATURES.md` and as `#acceptance`-tagged items in `TODO.md`.

## Reading-data corrections

- The home page's annual finish count excludes other years, can exceed six, and respects the selected time-machine date while retaining the recent-finish grid.
- Admin and MCP patches persist structured pullquotes with optional sources, normalize legacy string input, and remove quotes on null. Immediate store reads agree with the saved metadata. Invalid structured values cannot reach a write, and unrelated frontmatter keeps its existing scalar/list/null contract and formatting.
