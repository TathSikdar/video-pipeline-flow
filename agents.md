# Coding Standards and Style Guide

This document establishes the high-level coding standards for the **video-pipeline-flow** project. It combines core programming philosophies with language-specific rules to ensure all code—written by human developers or AI agents—is readable, modular, scalable, and maintainable.

---

## Core Coding Philosophy

To build a reliable and performant video pipeline, we follow four main software engineering pillars:

*   **Human Readability:** Code is read much more often than it is written. Use self-documenting naming conventions, clean spacing, and minimal inline complexity.
*   **Modularity & Reusability:** Break logic down into small, single-responsibility functions and classes. Code duplication is discouraged; reuse components or abstract helper utilities.
*   **Scalability & Performance:** Design with asynchronous processing, clean dependency management, and resource constraints in mind.
*   **Maintainability & Robustness:** Enforce strong typing, comprehensive error handling, structured logging, and thorough unit tests.

---

## Coding Style Guides & Instructions

For detailed coding standards, rules, and guidelines, refer to the following documents:

1.  **Python Code:**
    *   Please follow the [Google Python Style Guide](file:///d:/Productivity/Repos/video-pipeline-flow/docs/python_style_guide.md).
2.  **JavaScript / TypeScript Code:**
    *   Please follow the [Google JavaScript/TypeScript Style Guide](file:///d:/Productivity/Repos/video-pipeline-flow/docs/javascript_style_guide.md).
3.  **Project Requirements:**
    *   Please follow the [Project Requirements](file:///d:/Productivity/Repos/video-pipeline-flow/docs/project_requirements.md) containing core project goals, requirements, setup instructions, and evaluation criteria for the Video Pipeline Flow project.
4.  **Anti-Bot & Execution Environment Rules:**
    *   Please follow the [YouTube Download Pipeline Analysis](file:///d:/Productivity/Repos/video-pipeline-flow/docs/youtube_download_pipeline_analysis.md) for deep technical constraints regarding Client Identity, Cryptographic Attestation (BotGuard/DroidGuard), Signature Cipher Decryption, Browser Fingerprinting Evasion, WebSocket Authentication, Rate Limiting HTTP codes, Network Routing/IPv6 Topology, RAM disk specifications, Concurrency Threading, and SABR/UMP processing mechanics.
5.  **Project Plan:**
    *   Please follow the [Project Plan](file:///d:/Productivity/Repos/video-pipeline-flow/docs/project_plan.md). This file contains a detailed plan for each phase of the project. Each phase contains what problems we will be tackling during that phase. When getting to each problem, we will discuss the possible solutions to that problem. The user will give the go ahead on which solution to use for each problem.

---

## Agent-Specific Instructions

When coding or refactoring files in this repository, all AI agents must follow these operational guidelines:

1.  **Preserve Comments:** Do not delete comments, JSDoc annotations, or Python docstrings unless they are directly replaced by updated code.
2.  **Maintain Coding Style:** Always run matching linters/formatters if configured (e.g., `black`, `flake8`, `eslint`, `prettier`) before declaring a task complete.
3.  **Perform Minimal Diffs:** Avoid restructuring whole files if only a few lines need changes. Targeted updates minimize the risk of regression and speed up reviews.
4.  **No Placeholders:** Never submit stub methods or placeholder comments like `// TODO: Implement later` unless explicitly requested. Every path must be fully implemented, documented, and tested.
5.  **Context Ingestion:** Agents must read these reference files to ingest context before generating architecture blueprints or code files.
6.  **Documentation Rule:** All implementation choices (e.g., rotating IP system setup) must be recorded in `logs.md`. Entry must include exact step taken and technical reasoning in succinct format.
