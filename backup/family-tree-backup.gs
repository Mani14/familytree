// Google Apps Script — daily backup of the family tree's Firestore document
// into the script owner's own Google Drive. Not part of the web app's build;
// this lives and runs entirely inside script.google.com, under your own
// Google account's permissions. See backup/README.md for one-time setup.
//
// No new credential is created or stored anywhere: ScriptApp.getOAuthToken()
// returns a short-lived token for whichever Google account owns this script,
// scoped to exactly what's declared in this project's oauthScopes (Drive +
// Datastore/Firestore read). Firestore's REST API, called with that token,
// checks your account's IAM role on the GCP project directly — it does NOT
// go through firestore.rules (that only applies to the client SDK) — so this
// works as long as your Google account already has at least Viewer/Editor on
// the family-tree-3b760 project, which is true simply by virtue of you being
// the one who created it.
//
// Drive access uses the full `drive` scope, not the narrower `drive.file` —
// tried drive.file first, but Apps Script's DriveApp service (createFolder,
// getFoldersByName) doesn't work under it at all, only the full scope. The
// scope label is broad, but what actually runs under it is exactly the code
// in this file: create one "Family Tree Backups" folder, write JSON files
// into it, delete old ones from it. This is a private script only you ever
// run — nothing else executes with this permission.

const PROJECT_ID = 'family-tree-3b760';
const DOCUMENT_PATH = 'families/main';
const BACKUP_FOLDER_NAME = 'Family Tree Backups';
const KEEP_DAYS = 60; // older backups are pruned automatically, newer ones always kept

function backupFamilyTree() {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${DOCUMENT_PATH}`;
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(`Firestore fetch failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  const doc = JSON.parse(response.getContentText());
  const plain = firestoreFieldsToPlain(doc.fields || {});

  const folder = getOrCreateFolder(BACKUP_FOLDER_NAME);
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm');
  folder.createFile(`family-backup-${timestamp}.json`, JSON.stringify(plain, null, 2), MimeType.PLAIN_TEXT);

  pruneOldBackups(folder, KEEP_DAYS);
}

function getOrCreateFolder(name) {
  const existing = DriveApp.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(name);
}

function pruneOldBackups(folder, keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < cutoff) file.setTrashed(true);
  }
}

// Firestore's REST API wraps every value in a type-tagged object (e.g.
// {"stringValue": "Kesavamoorthy"}) instead of returning plain JSON directly —
// this recursively unwraps that into the same plain {rootPersonId, persons}
// shape the app's own Export JSON / Import JSON already use, so a backup
// file can be dropped straight back into the app's Import if ever needed.
function firestoreFieldsToPlain(fields) {
  const result = {};
  for (const key in fields) {
    result[key] = firestoreValueToPlain(fields[key]);
  }
  return result;
}

function firestoreValueToPlain(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.mapValue !== undefined) return firestoreFieldsToPlain(value.mapValue.fields || {});
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(firestoreValueToPlain);
  return null;
}

// Run this ONCE manually after pasting the script in (see backup/README.md) —
// it prompts you to authorize Drive + Firestore access, takes one backup
// immediately so you can confirm it worked, and schedules the daily trigger.
// Safe to re-run: clears any existing trigger for this function first, so it
// never ends up with duplicates.
function setupDailyBackup() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'backupFamilyTree') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupFamilyTree').timeBased().everyDays(1).atHour(3).create();
  backupFamilyTree(); // immediate first backup, so setup is verifiable right away
}
