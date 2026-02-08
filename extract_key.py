#!/usr/bin/env python3
"""
Windsurf API Key 提取工具（跨平台：macOS / Windows / Linux）

从 Windsurf 本地安装中提取 API Key，无需额外依赖。

用法:
  python extract_key.py          # 自动检测平台并提取
  python extract_key.py --json   # JSON 格式输出
"""

import json
import os
import platform
import sqlite3
import sys
from pathlib import Path


def get_db_path() -> Path:
    """获取 Windsurf state.vscdb 路径（跨平台）。"""
    system = platform.system()

    if system == "Darwin":  # macOS
        return Path.home() / "Library" / "Application Support" / "Windsurf" / "User" / "globalStorage" / "state.vscdb"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if not appdata:
            raise RuntimeError("无法获取 APPDATA 环境变量")
        return Path(appdata) / "Windsurf" / "User" / "globalStorage" / "state.vscdb"
    else:  # Linux
        config = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
        return Path(config) / "Windsurf" / "User" / "globalStorage" / "state.vscdb"


def extract_key(db_path: Path | None = None) -> dict:
    """
    从 Windsurf state.vscdb 提取 API Key。

    Returns:
        {"api_key": "sk-ws-01-...", "db_path": "/path/to/state.vscdb"}
        或 {"error": "..."}
    """
    if db_path is None:
        db_path = get_db_path()

    if not db_path.exists():
        return {
            "error": f"Windsurf 数据库未找到: {db_path}",
            "hint": "请确保 Windsurf 已安装并登录。",
            "db_path": str(db_path),
        }

    try:
        conn = sqlite3.connect(str(db_path))
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus'"
        ).fetchone()
        conn.close()
    except Exception as e:
        return {"error": f"读取数据库失败: {e}", "db_path": str(db_path)}

    if not row:
        return {
            "error": "未找到 windsurfAuthStatus 记录",
            "hint": "请确保 Windsurf 已登录。",
            "db_path": str(db_path),
        }

    try:
        data = json.loads(row[0])
    except json.JSONDecodeError:
        return {"error": "windsurfAuthStatus 数据解析失败", "db_path": str(db_path)}

    api_key = data.get("apiKey", "")
    if not api_key:
        return {"error": "apiKey 字段为空", "db_path": str(db_path)}

    return {"api_key": api_key, "db_path": str(db_path)}


def _print_mcp_config(api_key: str) -> None:
    """输出可直接粘贴到 ~/.claude.json 的 MCP 配置。"""
    mcp_dir = str(Path(__file__).resolve().parent)
    config = {
        "windsurf-fast-context": {
            "command": "uv",
            "args": ["--directory", mcp_dir, "run", "server.py"],
            "env": {"WINDSURF_API_KEY": api_key},
        }
    }
    print("复制以下内容到 ~/.claude.json 的 mcpServers 中：")
    print()
    print(json.dumps(config, ensure_ascii=False, indent=2))


def main() -> int:
    json_mode = "--json" in sys.argv
    mcp_mode = "--mcp" in sys.argv

    result = extract_key()

    if "error" in result:
        if json_mode:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"[!] {result['error']}")
            if "hint" in result:
                print(f"    {result['hint']}")
            print(f"    数据库路径: {result.get('db_path', 'N/A')}")
        return 1

    api_key = result["api_key"]

    if json_mode:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if mcp_mode:
        _print_mcp_config(api_key)
        return 0

    print(f"[OK] Windsurf API Key 提取成功")
    print(f"")
    print(f"  Key: {api_key[:30]}...{api_key[-10:]}")
    print(f"  长度: {len(api_key)} 字符")
    print(f"  来源: {result['db_path']}")
    print()

    system = platform.system()
    if system == "Darwin" or system == "Linux":
        print("配置方法 (选择一种):")
        print()
        print("  1. 环境变量 (推荐):")
        print(f'     export WINDSURF_API_KEY="{api_key}"')
        print()
        print("  2. 添加到 shell 配置 (~/.zshrc 或 ~/.bashrc):")
        print(f'     echo \'export WINDSURF_API_KEY="{api_key}"\' >> ~/.zshrc')
        print()
        print("  3. 直接生成 MCP 配置:")
        print(f'     python {__file__} --mcp')
    elif system == "Windows":
        print("配置方法 (选择一种):")
        print()
        print("  1. 环境变量 (推荐):")
        print(f'     set WINDSURF_API_KEY={api_key}')
        print()
        print("  2. 永久设置:")
        print(f'     setx WINDSURF_API_KEY "{api_key}"')
        print()
        print("  3. 直接生成 MCP 配置:")
        print(f'     python {__file__} --mcp')

    return 0


if __name__ == "__main__":
    sys.exit(main())
