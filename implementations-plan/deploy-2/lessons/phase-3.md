# deploy-2 phase 3: the pause limit, and the arc gate

- Dedupe: `gh issue list --state all --search "pause unpause same block"` and `--search "pause in:title"`: none.
- Filed #90 ("a pause and an unpause in one block hold a version's exits at no pause budget"), label `known-limit`,
  with the full Foundry reproducer; closed as not planned at once. `gh issue view 90`: CLOSED, NOT_PLANNED,
  `known-limit`.
- Linked from `docs/bridge.md` (the pause bullet and a paragraph in § The operators) and `docs/threat-model.md`'s
  bound row, with the full issue URL as `docs/roadmap.md` links upstream issues. `git diff origin/main -- protocol`
  is empty.
