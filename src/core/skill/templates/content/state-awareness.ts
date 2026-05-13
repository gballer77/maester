export const STATE_AWARENESS = `## State awareness (canon vs draft)

Every citadel file may declare a publication state of \`canon\` (authoritative)
or \`draft\` (work-in-progress). The state lives **inline** in the file using
the format's native convention:

- **Markdown / MDX (\`.md\`, \`.mdx\`)** — \`state\` field inside YAML frontmatter
  at the top of the file:
  \`\`\`
  ---
  state: canon
  ---
  \`\`\`
- **HTML (\`.html\`, \`.htm\`)** — first-line HTML comment:
  \`<!-- state: canon -->\`
- **YAML / JSON (\`.yaml\`, \`.yml\`, \`.json\`)** — a top-level \`state\` key.
- **Plain text (\`.txt\`)** — \`state: canon\` as the very first line.

Files without inline state default to \`draft\`.

**Policy when answering from the citadel:**

1. **Prefer \`canon\` files** as the authoritative source of truth. When a
   \`canon\` file answers the question, cite it and stop there.
2. **\`draft\` files are informational only.** Cite them when no \`canon\`
   alternative exists, but mark the citation explicitly: "(draft — work in
   progress)" alongside the file path so the user knows the source is not yet
   stable.
3. **Never mix the two without labeling.** If you draw from both canon and
   draft files in one answer, separate the two and tell the user which fact
   came from which kind of source.
`;
