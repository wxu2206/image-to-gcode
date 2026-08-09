# Security Policy

## Supported versions

During beta, security fixes are provided for the `main` branch and the latest published release. Older releases may not receive security updates.

## Report a vulnerability

Do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Please use [GitHub private vulnerability reporting](https://github.com/wxu2206/image-to-gcode/security/advisories/new). Include a clear description, reproduction steps or proof of concept, potential impact, and any suggested mitigation. Remove personal information and unrelated sensitive data from supporting files.

The maintainer will review the report and respond when possible. Please allow time to investigate and coordinate a fix before publicly disclosing the vulnerability.

If GitHub does not display the private reporting form, private vulnerability reporting has not yet been enabled for the repository. Do not open a public issue; check the repository's Security page for an updated private reporting method.

## Machine safety

Incorrect G-code can damage equipment or cause injury, but an unsafe output is not automatically a software security vulnerability. Report reproducible G-code correctness or machine-safety bugs with the bug report form unless disclosure would reveal a security vulnerability. Never run unreviewed generated output on real equipment.
