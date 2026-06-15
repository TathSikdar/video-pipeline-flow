# Google Python Style Guide

This document defines the Python coding standards for this project, adhering to the [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html).

---

## Formatting & Layout

*   **Indentation:** Use **4 spaces** per indentation level. Do not use tabs.
*   **Line Length:** Limit all lines to a maximum of **80 characters**.
    *   *Exception:* Long import statements, URLs, or path comments where breaking is impossible or reduces readability.
*   **Imports:** Imports should be on separate lines and grouped at the top of the file in the following order, separated by a blank line:
    1.  Standard library imports.
    2.  Third-party library imports.
    3.  Local application/library imports.
    *   *Avoid wildcard imports:* Never use `from module import *`.
*   **Whitespace:**
    *   Two blank lines before top-level function and class definitions.
    *   One blank line before class method definitions.
    *   No trailing whitespace at the end of lines.
    *   No spaces inside parentheses, brackets, or braces (e.g., `spam(ham[1], {eggs: 2})`, not `spam( ham[ 1 ], { eggs: 2 } )`).

---

## Naming Conventions

We use PEP 8 compliant names matching the Google style:

| Object Type | Case | Example |
| :--- | :--- | :--- |
| **Modules / Packages** | lowercase (underscores allowed but discouraged unless necessary) | `video_processor`, `file_utils` |
| **Classes** | CapWords (PascalCase) | `PipelineManager`, `FrameExtractor` |
| **Functions / Methods** | lowercase_with_underscores (snake_case) | `extract_audio()`, `process_frame()` |
| **Variables / Attributes** | lowercase_with_underscores (snake_case) | `frame_count`, `is_completed` |
| **Constants** | ALL_CAPS_WITH_UNDERSCORES | `MAX_QUEUE_SIZE`, `DEFAULT_FPS` |
| **Protected Elements** | Leading underscore | `_internal_state`, `_compute_hash()` |
| **Private Elements** | Double leading underscore (use sparingly) | `__highly_private_val` |

---

## Type Annotations

Type annotations are **highly encouraged** for all public APIs, class attributes, and complex internal helpers.

*   Use standard PEP 484/585 typing annotations.
*   Always annotate function signatures:
    ```python
    def process_video(file_path: str, fps: int = 30) -> bool:
        # Implementation...
    ```
*   Use `Optional[T]` (or `T | None` in modern Python) when a value can be `None`.

---

## Docstrings & Comments

All modules, classes, and public functions must have a docstring conforming to the **Google Docstring Format**.

### Function Docstring Example:
```python
def extract_frames(video_path: str, output_dir: str, target_fps: int = 30) -> list[str]:
    """Extracts frames from a local video file at a specified frame rate.

    Args:
        video_path: The absolute file path to the source video.
        output_dir: The directory where the extracted frame files will be saved.
        target_fps: The number of frames to extract per second of video.

    Returns:
        A list of absolute file paths to the successfully extracted frame images.

    Raises:
        FileNotFoundError: If the video_path does not exist on disk.
        ValueError: If the target_fps is non-positive.
    """
    # implementation here
```

---

## Language Rules & Best Practices

1.  **Mutable Default Arguments:** Never use mutable objects (like lists or dictionaries) as default arguments in function definitions.
    ```python
    # BAD
    def append_to(element, target=[]):
        target.append(element)
        return target

    # GOOD
    def append_to(element, target=None):
        if target is None:
            target = []
        target.append(element)
        return target
    ```
2.  **Context Managers:** Always use `with` statements for managing files, locks, database sessions, and other system resources.
    ```python
    with open('log.txt', 'r', encoding='utf-8') as f:
        data = f.read()
    ```
3.  **Exception Handling:**
    *   Never use bare `except:` clauses. Always specify the exceptions you expect to catch.
    *   Avoid catching generic `Exception` unless re-raising, logging and terminating, or wrapping them in a domain-specific exception.
4.  **List Comprehensions:** Use list/dict/set comprehensions when simple. Avoid complex nesting or multi-line comprehension syntax; use regular loops instead for readability.
