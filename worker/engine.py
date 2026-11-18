"""Pure functional processing engine for AI task operations."""

from typing import Any, Callable, Dict


def uppercase(text: str) -> str:
    """Converts input text to uppercase, preserving Unicode."""
    return text.upper()


def lowercase(text: str) -> str:
    """Converts input text to lowercase, preserving Unicode."""
    return text.lower()


def reverse_string(text: str) -> str:
    """Reverses the character sequence of input text, preserving Unicode."""
    return text[::-1]


def word_count(text: str) -> int:
    """Counts whitespace-delimited words in input text."""
    return len(text.split())


# Operation registry mapping names to pure callable functions
OPERATIONS: Dict[str, Callable[[str], Any]] = {
    "uppercase": uppercase,
    "lowercase": lowercase,
    "reverse_string": reverse_string,
    "word_count": word_count,
}


def execute_operation(operation: str, input_data: Any) -> str:
    """Validates inputs, dispatches the requested operation, and returns the result as a string.

    Args:
        operation: The registered operation identifier.
        input_data: The input string to process.

    Returns:
        The stringified output of the operation (ensuring MongoDB String schema compliance).

    Raises:
        TypeError: If operation is not a string, or input_data is not a string.
        ValueError: If operation is not supported.
    """
    if not isinstance(operation, str):
        raise TypeError(f"Operation must be a string, got {type(operation).__name__}")

    op_name = operation.strip()
    if not op_name:
        raise ValueError("Operation cannot be empty or whitespace only")

    if op_name not in OPERATIONS:
        supported = ", ".join(sorted(OPERATIONS.keys()))
        raise ValueError(
            f"Unsupported operation: '{op_name}'. Supported operations are: {supported}"
        )

    if not isinstance(input_data, str):
        raise TypeError(
            f"Task input data must be a string, got {type(input_data).__name__}"
        )

    processor = OPERATIONS[op_name]
    raw_result = processor(input_data)

    # MongoDB Task schema specifies `result: { type: String }`.
    # Convert all results (including integer count from word_count) to str.
    return str(raw_result)
