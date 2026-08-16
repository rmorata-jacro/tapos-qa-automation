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
| `shared/safety/` | Automation safety helpers (reserved). |
| `shared/test-data/` | Runtime test-data discovery, creation, validation, and cleanup helpers (reserved). |
| `config/` | Test-environment configuration. |
| `tests/` | Top-level smoke/regression orchestration only when appropriate. |
| `.cursor/agents/` | Cursor agents, including the Test Case Manager responsible for test case management. |
| `.cursor/rules/` | Persistent instructions for Cursor agents. |

## Automation Stack (Planned)

**Playwright + TypeScript** is planned as the primary web automation framework. It is not installed yet.

Desktop and JavPOS automation will be evaluated separately rather than forcing them into Playwright.
