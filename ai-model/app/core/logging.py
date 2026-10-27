"""DevPilot AI - Structured Logging Configuration.

Configures console logging with formatted timestamps and component loggers.
"""

import logging
import sys


def setup_logging(log_level: str = "INFO") -> None:
    """Configures root logger with a clean format and specified log level."""
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    log_format = (
        "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s"
    )
    date_format = "%Y-%m-%d %H:%M:%S"

    logging.basicConfig(
        level=numeric_level,
        format=log_format,
        datefmt=date_format,
        handlers=[
            logging.StreamHandler(sys.stdout)
        ],
        force=True
    )

    # Quiet overly verbose third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Returns a named logger instance."""
    return logging.getLogger(f"devpilot-ai.{name}")
