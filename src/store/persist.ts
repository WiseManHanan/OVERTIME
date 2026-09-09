/*
 * localStorage persistence (doc §8.1). Phase 4 needs only the mute flag; scores,
 * asterisks and the daily record land here in Phase 6.
 *
 * Every access is wrapped — private browsing and storage-disabled contexts throw
 * on read as well as write, and the game must run regardless.
 */

const MUTE_KEY = "overtime.mute";

export function loadMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMute(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable — the session-local flag still works */
  }
}
