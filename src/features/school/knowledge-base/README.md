# School Knowledge Base

Reference material the Study Generator (and any future School tool) loads
into its prompt construction before calling a model — same idea as this
project's own skill-reference pattern, applied to academic writing instead
of coding tasks.

Nothing here is executed. These are markdown files read at prompt-build
time (`src/features/school/study-generator/lib/promptBuilder.ts`) and
concatenated into the system context sent to the model, so generations are
grounded in explicit guidance rather than a bare "write a study guide"
prompt.

## Files

- `tone-guides.md` — how register/vocabulary/sentence complexity should
  shift by grade band (elementary / middle / high school / college).
- `structure-templates.md` — the shape of each document type the Study
  Generator can produce (study guide, essay analysis, scene-by-scene
  breakdown, practice questions).
- `writing-style-guide.md` — how to avoid generic, obviously-AI-patterned
  prose: sentence rhythm, concrete language, banned filler phrases.

## Licensing note (fonts/templates)

The task also called for a local fonts/templates library for academic
documents. No such library exists yet — see `NOTES.md` for why this was
deferred rather than guessed at.
