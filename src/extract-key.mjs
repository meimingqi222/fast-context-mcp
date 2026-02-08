/**
 * Windsurf API Key extraction from local installation.
 *
 * Cross-platform: macOS / Windows / Linux.
 * Uses better-sqlite3 to read state.vscdb.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import Database from "better-sqlite3";

/**
 * Get the platform-specific path to Windsurf's state.vscdb.
 * @returns {string}
 */
export function getDbPath() {
  const plat = platform();
  const home = homedir();

  if (plat === "darwin") {
    return join(home, "Library", "Application Support", "Windsurf", "User", "globalStorage", "state.vscdb");
  } else if (plat === "win32") {
    const appdata = process.env.APPDATA || "";
    if (!appdata) throw new Error("Cannot determine APPDATA path");
    return join(appdata, "Windsurf", "User", "globalStorage", "state.vscdb");
  } else {
    // Linux
    const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
    return join(config, "Windsurf", "User", "globalStorage", "state.vscdb");
  }
}

/**
 * Extract API Key from Windsurf state.vscdb.
 * @param {string} [dbPath]
 * @returns {{ api_key?: string, db_path: string, error?: string, hint?: string }}
 */
export function extractKey(dbPath) {
  if (!dbPath) {
    dbPath = getDbPath();
  }

  if (!existsSync(dbPath)) {
    return {
      error: `Windsurf database not found: ${dbPath}`,
      hint: "Ensure Windsurf is installed and logged in.",
      db_path: dbPath,
    };
  }

  let row;
  try {
    const db = new Database(dbPath, { readonly: true });
    row = db.prepare("SELECT value FROM ItemTable WHERE key = 'windsurfAuthStatus'").get();
    db.close();
  } catch (e) {
    return { error: `Failed to read database: ${e.message}`, db_path: dbPath };
  }

  if (!row) {
    return {
      error: "windsurfAuthStatus record not found",
      hint: "Ensure Windsurf is logged in.",
      db_path: dbPath,
    };
  }

  let data;
  try {
    data = JSON.parse(row.value);
  } catch {
    return { error: "windsurfAuthStatus data parse failed", db_path: dbPath };
  }

  const apiKey = data.apiKey || "";
  if (!apiKey) {
    return { error: "apiKey field is empty", db_path: dbPath };
  }

  return { api_key: apiKey, db_path: dbPath };
}
