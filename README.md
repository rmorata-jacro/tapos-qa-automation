# TaPoS QA Automation

Automated validation of TaPoS/JACRO products and interconnected workflows.

This repository is a QA automation framework for TaPoS/JACRO web products and cross-product workflows.

## Environment Policy

**Automation is restricted to the approved TEST environment and must never run against production.**

Do not use production URLs, databases, credentials, accounts, payment details, or real customer data. If something appears to target production, stop and report it rather than continuing.

See `.cursor/rules/qa-safety.mdc` for persistent safety requirements applied to all work in this repository.

## Repository Layout

This repository is organized around product-specific automation, cross-product workflows, shared QA infrastructure, and Cursor agents and project rules.

| Directory | Purpose |
|-----------|---------|
| `products/` | Automation and reusable components belonging to a specific TaPoS/JACRO product. |
| `workflows/` | Business journeys that involve more than one product. |
| `shared/` | Reusable QA infrastructure used across products and workflows. |
| `shared/safety/` | Environment guard, safety-level execution gates, network policy, approval gates, redaction. |
| `shared/test-data/` | Runtime test-data helpers (TEST inbox plus-addressing and inbox interface). |
| `config/` | Test-environment configuration. |
| `tests/` | Top-level smoke/regression orchestration only when appropriate. |
| `.cursor/agents/` | Cursor agents, including the Test Case Manager responsible for test case management. |
| `.cursor/rules/` | Persistent instructions for Cursor agents. |

## Automation Stack

**Playwright + TypeScript** is the primary web automation framework (`playwright.config.ts`).
The suite to run is selected with `QA_SUITE`; with no selection only the framework self-tests run.
Every test declares a safety level that is enforced at runtime by `shared/safety/`.
See `products/cloud-signup/README.md` for the first product suite (INT-3437) and its commands.

TaPoS Admin and JavPOS automation will be evaluated separately rather than forcing them into Playwright.
