#!/usr/bin/env python3
"""
Windsurf Fast Context MCP Server

AI-driven semantic code search via reverse-engineered Windsurf protocol.

Configuration (environment variables):
  WINDSURF_API_KEY     — Windsurf API key (auto-discovered from local install if not set)
  FC_MAX_TURNS         — Search rounds per query (default: 3)
  FC_MAX_COMMANDS      — Max parallel commands per round (default: 8)

Start:
  python server.py
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from core import extract_key_info, search_with_content

# Read config from environment
MAX_TURNS = int(os.environ.get("FC_MAX_TURNS", "3"))
MAX_COMMANDS = int(os.environ.get("FC_MAX_COMMANDS", "8"))

mcp = FastMCP(
    "windsurf-fast-context",
    instructions=(
        "Windsurf Fast Context — AI-driven semantic code search tool. "
        "Returns relevant file paths with line ranges and suggested search keywords. "
        "IMPORTANT: Examine ALL returned files to get complete context. "
        "Use the suggested keywords with grep/rg to discover additional relevant files."
    ),
)


@mcp.tool()
def fast_context_search(
    query: str,
    project_path: str = "",
) -> str:
    """
    AI-driven semantic code search using Windsurf Fast Context.

    Performs multi-turn code search with ripgrep, file reading, and directory
    traversal to locate the most relevant code files and line ranges.

    Returns:
    1. Relevant file list with line ranges — examine ALL files for full context
    2. Suggested search keywords (rg patterns) — use with grep/rg to find more files

    Args:
        query: Natural language search query (e.g. "where is auth handled", "database connection pool")
        project_path: Absolute path to project root. Empty = current working directory.

    Returns:
        File list with line ranges + suggested search keywords
    """
    if not project_path:
        project_path = os.getcwd()

    if not os.path.isdir(project_path):
        return f"Error: project path does not exist: {project_path}"

    try:
        return search_with_content(
            query=query,
            project_root=project_path,
            max_turns=MAX_TURNS,
            max_commands=MAX_COMMANDS,
        )
    except Exception as e:
        return f"Error: {e}"


@mcp.tool()
def extract_windsurf_key() -> str:
    """
    Extract Windsurf API Key from local installation.

    Auto-detects OS (macOS/Windows/Linux) and reads the API key from
    Windsurf's local database. Set the result as WINDSURF_API_KEY env var.

    Returns:
        API Key info or error message.
    """
    result = extract_key_info()
    if "error" in result:
        return f"Error: {result['error']}\n{result.get('hint', '')}\nDB path: {result.get('db_path', 'N/A')}"

    key = result["api_key"]
    return (
        f"Windsurf API Key extracted successfully\n\n"
        f"  Key: {key[:30]}...{key[-10:]}\n"
        f"  Length: {len(key)}\n"
        f"  Source: {result['db_path']}\n\n"
        f"Usage:\n"
        f"  export WINDSURF_API_KEY=\"{key}\""
    )


def main():
    mcp.run()


if __name__ == "__main__":
    main()
