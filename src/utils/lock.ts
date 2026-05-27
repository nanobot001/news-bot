import fs from "node:fs";
import path from "node:path";

const LOCK_FILE_PATH = path.join(process.cwd(), "polling.lock");

/**
 * Attempts to acquire a file-based lock.
 * Returns true if lock was successfully acquired (or if in test mode).
 * Returns false if another active process is currently holding the lock.
 */
export function acquireLock(): boolean {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.DATABASE_URL?.includes("test") ||
    process.env.DATABASE_URL?.includes("dev-test")
  ) {
    return true;
  }

  try {
    // Attempt to write our process ID to the lock file atomically
    fs.writeFileSync(LOCK_FILE_PATH, process.pid.toString(), { flag: "wx" });
    return true;
  } catch (err: any) {
    if (err.code === "EEXIST") {
      try {
        const content = fs.readFileSync(LOCK_FILE_PATH, "utf8").trim();
        const pid = parseInt(content, 10);

        if (!isNaN(pid)) {
          try {
            // process.kill(pid, 0) checks if process is active
            process.kill(pid, 0);
            // Process is still running, lock is held
            return false;
          } catch (killErr: any) {
            // ESRCH means process is dead (stale lock)
            if (killErr.code === "ESRCH") {
              console.warn(`[Lock] Cleaning up stale lock file from dead process ${pid}.`);
              try {
                fs.unlinkSync(LOCK_FILE_PATH);
                // Attempt to acquire again
                fs.writeFileSync(LOCK_FILE_PATH, process.pid.toString(), { flag: "wx" });
                return true;
              } catch (retryErr) {
                // Return false if someone else acquired it in the meantime
                return false;
              }
            }
          }
        }
      } catch (readErr) {
        return false;
      }
    }
    return false;
  }
}

/**
 * Releases the file-based lock if it is held by the current process.
 */
export function releaseLock(): void {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.DATABASE_URL?.includes("test") ||
    process.env.DATABASE_URL?.includes("dev-test")
  ) {
    return;
  }

  try {
    if (fs.existsSync(LOCK_FILE_PATH)) {
      const content = fs.readFileSync(LOCK_FILE_PATH, "utf8").trim();
      const pid = parseInt(content, 10);
      if (pid === process.pid) {
        fs.unlinkSync(LOCK_FILE_PATH);
      }
    }
  } catch (err) {
    console.error("[Lock] Error releasing lock:", err);
  }
}
