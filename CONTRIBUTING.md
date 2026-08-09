# Contributing to image-to-gcode

Thank you for helping improve image-to-gcode. The project is in beta: its main features work, but some areas still need improvement, testing, and performance work. Bug reports, feature requests, code contributions, and respectful questions are welcome.

## Before you begin

- Search existing issues before opening a new one.
- Use the bug report or feature request form so the maintainer receives the information needed to respond.
- Report security vulnerabilities privately by following [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.

## Report a bug

Use the structured bug report form. Include clear reproduction steps, the expected and actual behaviour, your browser and operating system, and the relevant conversion mode and machine profile. When useful, attach the smallest image and generated G-code that reproduce the problem.

Remove personal, confidential, or machine-sensitive information from files before uploading them. Generated G-code must always be reviewed before it is run on real equipment.

## Request a feature

Use the feature request form and explain the problem the feature would solve. A suggested solution is helpful, but it is not required. Small, focused ideas are easier to discuss and implement.

## Make a code contribution

1. Fork the repository and create a branch from `main`.
2. Install dependencies with `npm ci`.
3. Start the development server with `npm run dev`.
4. Keep conversion geometry, machine transformation, and G-code serialization separate.
5. Add or update deterministic tests when behaviour changes.
6. Open a focused pull request that explains what changed and why.

The project uses Node.js 24 for continuous integration.

## Checks

Please run these checks before opening a pull request when possible:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

If a check fails for a reason unrelated to your change, explain that in the pull request. New contributors are welcome to ask for help rather than abandoning a useful contribution.

## Pull request guidance

- Keep each pull request focused on one change or closely related group of changes.
- Explain user-visible effects and performance implications.
- Include screenshots for interface changes.
- Describe how the change was tested.
- Avoid committing generated build output or unrelated formatting changes.
- Treat machine safety warnings and G-code correctness as high-priority concerns.

By contributing, you agree that your contribution will be licensed under the repository's [MIT License](LICENSE).
