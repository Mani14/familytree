# Daily family tree backup (Google Apps Script)

Backs up the shared family tree (Firestore `families/main`) once a day into a
"Family Tree Backups" folder in **your own Google Drive** — no paid Firebase
plan, no new hosting, no secret to manage. It runs entirely on Google's own
infrastructure under your Google account.

## One-time setup (~5 minutes)

1. Go to **https://script.google.com** and sign in with the same Google
   account you use for this project (manikandan.ks.14@gmail.com), then click
   **New project**.
2. Rename the project (top-left, "Untitled project") to something like
   `Family Tree Backup`.
3. Delete the placeholder `Code.gs` content and paste in the contents of
   [`family-tree-backup.gs`](family-tree-backup.gs) from this folder.
4. Click the gear icon (**Project Settings**) in the left sidebar, and check
   **"Show appsscript.json manifest file in editor"**.
5. Go back to the editor, open the new `appsscript.json` file that appears,
   and replace its contents with [`appsscript.json`](appsscript.json) from
   this folder (this declares the Drive + Firestore permissions the script
   needs).
6. In the function dropdown at the top (next to Run/Debug), select
   **`setupDailyBackup`**, then click **Run**.
7. Google will ask you to authorize the script — click through the consent
   screens (it'll warn "Google hasn't verified this app" since it's your own
   personal script; click **Advanced → Go to Family Tree Backup (unsafe)** to
   proceed. This is expected and safe — it's a script you just wrote,
   running only under your own account). On the permissions screen, check
   **Select all** — all four listed permissions are required: Drive,
   Firestore/Datastore, connecting to an external service, and running on a
   schedule while you're not present. The Drive permission is the full
   "all your files" scope, not a narrower one — Apps Script's Drive service
   doesn't support creating folders under the more limited scope — but see
   the note at the top of `family-tree-backup.gs`: what actually runs under
   that permission is only ever the code in this one script (create a
   backup folder, write files into it, delete old ones), never anything
   broader.
8. Check your Google Drive for a new **"Family Tree Backups"** folder with
   one file already in it (`family-backup-<date>.json`) — that confirms the
   first backup succeeded and the daily trigger (3 AM your time, every day)
   is now scheduled.

## Restoring from a backup

If something gets deleted or corrupted in the live tree, any backup file in
that Drive folder is already in the exact format the app itself understands —
open the app, use the header/mobile menu's **Download → Import JSON**, and
select the backup file you want to restore. This *replaces* the whole tree
with that backup's contents (it's covered by the app's own Undo, but only
until the app is closed), so double-check you're picking the right date.

## Checking it's still running

- **Apps Script dashboard** (https://script.google.com) → open the project →
  the clock icon on the left ("Triggers") shows the scheduled run and its
  last execution status.
- **Executions** (also in the left sidebar) shows a log of every past run,
  including any failures and their error messages.

## Changing the schedule or retention

- `atHour(3)` in `setupDailyBackup()` sets what hour backups run — change the
  number and re-run `setupDailyBackup` (it clears the old trigger first, so
  it's safe to re-run any time).
- `KEEP_DAYS` at the top of the script controls how long old backups are kept
  before being auto-deleted from Drive (default 60 days).
