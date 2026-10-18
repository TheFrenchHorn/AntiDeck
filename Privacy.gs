/**
 * Privacy helpers. Add as a NEW file in Apps Script, e.g. "Privacy.gs".
 *
 * In a web app, any PUBLIC function (name without a trailing underscore) can be called by any visitor
 * through google.script.run, running with the owner's permissions. assertOwner_() makes a function
 * owner-only: it throws unless the person running it is the same account that owns the script.
 */
function assertOwner_() {
  var eff = Session.getEffectiveUser().getEmail(), act = Session.getActiveUser().getEmail();
  if (!eff || !act || eff !== act) throw new Error('Not authorized.');
}

/** Run once from the editor (select purgeSharedData -> Run): deletes the shared deck-backup sheet created by the old version. */
function purgeSharedData() {
  assertOwner_();
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('AntiDeck State'), msg = [];
  if (sh) { if (ss.getSheets().length > 1) ss.deleteSheet(sh); else sh.clear(); msg.push('Deleted the "AntiDeck State" sheet.'); } else msg.push('No "AntiDeck State" sheet found.');
  PropertiesService.getScriptProperties().deleteProperty('CHAT_USAGE'); msg.push('Reset chat usage counters.');
  Logger.log(msg.join(' '));
}
