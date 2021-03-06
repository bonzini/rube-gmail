// Sample Google Apps Script for filtering Bugzilla and mailing lists
// using the Google Apps Script advanced API
//
// Note: the Google Apps Script advanced API must be enabled manually.
// See https://developers.google.com/apps-script/guides/services/advanced
//
// Bugzilla filter
// ---------------
// This works together with a pair of server filters like
//   from:bugzilla@redhat.com -> Skip inbox, Apply label "unprocessed"
//   from:bugzilla@redhat.com -> Skip inbox, Apply label "bugzilla"
//
// There are three more labels nested under "bugzilla" ("closed", mine", "new")
// The unprocessed label makes it easy to do the heavier processing just once
// for each message.
//
// Mailing list filter
// -------------------
// In order to know all mailing lists through which you received a message, you
// have to create a GMail filter with a "list:foo@bar.org" query.  Such filters
// are evaluated before deduplication, so that if you get the message from >1 
// mailing list you will have multiple labels applied.
//
// However, often you will want such filters to have also "skip inbox".  If you
// do that, you will _never_ get that message in the inbox, not even if a
// separate copy is delivered to you as a To/Cc/Bcc recipient.  That's
// because _applying_ the filters is done _after_ deduplication, and
// "skip inbox" is implemented internally as "remove inbox label".
//
// This filter tries to move back such messages in the inbox.  To use it,
// duplicate the "list:foo@bar.org" filter to also apply the "unprocessed" label.
//  For example:
//   list:qemu-devel@nongnu.org -> Skip inbox, Apply label "unprocessed",
//   list:qemu-devel@nongnu.org -> Skip inbox, Apply label "qemu-devel"
//
// Such a filter can be created for example with
//   python gmail-filter.py --json /path/to/client_secret.json \
//        --create_list_filter qemu-devel@nongnu.org \
//        --skip_inbox --add_label qemu-devel
//   python gmail-filter.py --json /path/to/client_secret.json \
//        --create_list_filter qemu-devel@nongnu.org \
//        --skip_inbox --add_label unprocessed
//
// This Javascript filter looks at GMail server side filters that have a
// "list:foo@bar.org" query and an "add label" action.  It then looks for
// unprocessed messages with that label and detects those that should be in the
// inbox by two strategies:
//  - anything that has you in to/cc.   This does _not_ handle subscribing with
//    yourname+something@example.com.
//  - anything that has no List-id.  This works on the assumption that the
//    mailing list server introduces some delay, and you will get the direct
//    email first.  Because the first copy is the one that dedup uses, not
//    seeing List-id means (sufficient condition, but hopefully close enough
//    to necessary...) that you got a direct copy.
//
// Patch filter
// ------------
// The patch filter moves "patch" emails out of the inbox and into an
// "INBOX/patch" label.  It requires no server side filters.
//
// Author: Paolo Bonzini <pbonzini@redhat.com>
// License: AGPLv3

/////////////////////////////////////////////////////////////////////////
// utility functions for advanced API
/////////////////////////////////////////////////////////////////////////

function getLabelIdsByName() {
  var labels = Gmail.Users.Labels.list('me').labels;
  var labelsByName = {};
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    if (label.type == 'user') {
      labelsByName[label.name] = label.id;
    }
  }
  return labelsByName
}

function getHeadersDictionary(message) {
  var headersArray = message.payload.headers;
  var headers = {};
  for (i = 0; i < headersArray.length; i++) {
    headers[headersArray[i].name.toLowerCase()] = headersArray[i].value;
  }
  return headers;
}

function hasHeader(message, header) {
  var headersArray = message.payload.headers;
  for (i = 0; i < headersArray.length; i++) {
    if (headersArray[i].name.toLowerCase() == header) {
      return true;
    }
  }
  return false;
}

function getHeader(message, header) {
  var headersArray = message.payload.headers;
  for (i = 0; i < headersArray.length; i++) {
    if (headersArray[i].name.toLowerCase() == header) {
      return headersArray[i].value;
    }
  }
  return '';
}

function getMessageById(messageId) {
  return Gmail.Users.Messages.get('me', messageId, {'format':'metadata'});
}

function searchMessages(q) {
  Logger.log('>> ' + q)
  var response = Gmail.Users.Messages.list('me', { q: '-is:chats ' + q });
  return response.messages ? response.messages : [];
}

function addLabelToMessages(ids, label) {
  if (ids.length) {
    Gmail.Users.Messages.batchModify({ 'ids': ids, 'addLabelIds': [label] }, 'me');
  }
}

function removeLabelFromMessages(ids, label) {
  if (ids.length) {
    Gmail.Users.Messages.batchModify({ 'ids': ids, 'removeLabelIds': [label] }, 'me');
  }
}

function addLabelToThreads(ids, label) {
  for (i in ids) {
    Gmail.Users.Threads.modify({ 'addLabelIds': [label] }, 'me', ids[i]);
  }
}

function removeLabelFromThreads(ids, label) {
  for (i in ids) {
    Gmail.Users.Threads.modify({ 'removeLabelIds': [label] }, 'me', ids[i]);
  }
}

/////////////////////////////////////////////////////////////////////////

function doBugzilla(labelsByName, unprocessedLabel, allMessages, label) {
  // the actual filter
  var unprocessedQuery = unprocessedLabel == 'STARRED' ? 'is:starred' : 'label:unprocessed';
  var LABEL_MINE = labelsByName[label + "/mine"];
  var LABEL_CLOSED = labelsByName[label + "/closed"];
  var LABEL_NEW = labelsByName[label + "/new"];
  var messages = searchMessages(unprocessedQuery + ' label:' + label);
  
  var threadsForClosed = {}
  var threadsForOpen = {}
  var messagesForMine = []
  var messagesForNew = []
  var messagesForInbox = []
 
  for (i in messages) {
    var messageId = messages[i].id;
    var threadId = messages[i].threadId;
    var message = getMessageById(messageId);
    var h = getHeadersDictionary(message);
    var time = parseInt(message.internalDate);

    if (h['x-bugzilla-type'] == 'new') {
      messagesForNew.push(messageId)
    }

    if (h['x-bugzilla-status'] == 'CLOSED' || h['x-bugzilla-status'] == 'VERIFIED' || h['x-bugzilla-status'] == 'RELEASE_PENDING') {
      if (!(threadId in threadsForClosed) || threadsForClosed[threadId] < time) {
        threadsForClosed[threadId] = time;
      }
    } else {
      if (!(threadId in threadsForOpen) || threadsForOpen[threadId] < time) {
        threadsForOpen[threadId] = time;
      }
    }

    if ('x-bugzilla-reason' in h) {
      var reason = h['x-bugzilla-reason'].toLowerCase();
      if (reason != 'none') {
        messagesForMine.push(messageId);
      }
      if (reason.search('needinfo') != -1 || reason.search('canceled') != -1) {
        messagesForInbox.push(messageId);
      }
    }
    allMessages.push(messageId);
  }

  // decide whether the most recent message is in open or closed state
  for (i in threadsForClosed) {
    if ((i in threadsForOpen) && threadsForOpen[i] < threadsForClosed[i]) {
      delete threadsForOpen[i];
    }
  }
  for (i in threadsForOpen) {
    if ((i in threadsForClosed) && threadsForClosed[i] < threadsForOpen[i]) {
      delete threadsForClosed[i];
    }
  }

  // now do all modifications in batch fashion
  removeLabelFromThreads(Object.keys(threadsForOpen), LABEL_CLOSED);
  addLabelToThreads(Object.keys(threadsForClosed), LABEL_CLOSED);
  addLabelToMessages(messagesForMine, LABEL_MINE);
  addLabelToMessages(messagesForNew, LABEL_NEW);
  addLabelToMessages(messagesForInbox, 'INBOX');
}

/////////////////////////////////////////////////////////////////////////

function isPatch(subject) {
  if (subject.substring(0, 4) == "[Fwd") {
    subject = subject.substring(1, subject.length - 1);
  }
  while(subject.substring(0, 1) != "[") {
    match = /^[A-Za-z]+:\s*/.exec(subject);
    if (!match) {
      return false;
    }
    subject = subject.substring(match[0].length).trim()
  }
  while(subject.substring(0, 1) == "[") {
    match = /^\[[^\]]*\]\s*/.exec(subject);
    if (!match) {
      return false;
    }
    if (match[0].toLowerCase().includes("patch")) {
      return true;
    }
    subject = subject.substring(match[0].length).trim()
  }
  return false;
}

function doInboxPatches(labelsByName, patchLabel) {
  var messages = searchMessages('in:inbox subject:patch is:unread');
  var allMessages = [];
  var patchMessages = [];
  for (i in messages) {
    var messageId = messages[i].id
    var msg = getMessageById(messageId)
    allMessages.push(messageId)
    if (isPatch(getHeader(msg, 'subject'))) {
      patchMessages.push(messageId)
    }
  }

  if (patchMessages.length) {
    addLabelToMessages(patchMessages, labelsByName[patchLabel]);
  }
  if (allMessages.length) {
    removeLabelFromMessages(allMessages, 'INBOX');
  }
  Logger.log('found ' + patchMessages.length + ' patches in ' + allMessages.length + ' messages')
}

function doMailingListToFolder(labelName, unprocessedLabel, destLabel, allMessages, toCcQuery) {
  labelName = labelName.replace(/[ /]/g, '-');
  var unprocessedQuery = unprocessedLabel == 'STARRED' ? 'is:starred' : 'label:unprocessed';
  var messages = searchMessages(unprocessedQuery + ' label:' + labelName + ' ' + toCcQuery);
  var messagesToLabel = [];
  for (i in messages) {
    var messageId = messages[i].id;
    allMessages.push(messageId);
    messagesToLabel.push(messageId);
  }

  messages = searchMessages(unprocessedQuery + ' label:' + labelName + ' -' + toCcQuery);
  var messagesToLabel = [];
  for (i in messages) {
    var messageId = messages[i].id
    var msg = getMessageById(messageId)
    if (!hasHeader(msg, 'list-id')) {
      messagesToLabel.push(messageId)
    }
    allMessages.push(messageId)
  }

  addLabelToMessages(messagesToLabel, destLabel);
}

function doMailingListsToFolder(allMessages, unprocessedLabel, destLabel, toCcQuery) {
  // Find all filters that are associated to a "list:xxx" query and
  // that add a label.  These are the labels we need to process.
  //
  // Note that the label ID is *not* the label name.

  var filters = Gmail.Users.Settings.Filters.list('me').filter;
  var mailingListLabels = {};
  for (var i = 0; i < filters.length; i++) {
    var filter = filters[i];
    if (('query' in filter.criteria) && ('addLabelIds' in filter.action) && filter.criteria.query.substr(0, 5) == 'list:') {
      var labelIds = filter.action.addLabelIds;
      for (j in labelIds) {
        if (labelIds[j] != unprocessedLabel) {
          mailingListLabels[labelIds[j]] = filter.criteria.query;
        }
      }
    }
  }

  var labels = Gmail.Users.Labels.list('me').labels;
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    if (label.type == 'user' && label.id in mailingListLabels) {
      doMailingListToFolder(label.name, unprocessedLabel, destLabel, allMessages, toCcQuery);
    }
  }
}

/////////////////////////////////////////////////////////////////////////

function listLabels() {
  var response = Gmail.Users.Labels.list('me');
  if (response.labels.length == 0) {
    Logger.log("No labels found.");
  } else {
    Logger.log("Labels:");
    for (var i = 0; i < response.labels.length; i++) {
      var label = response.labels[i];
      Logger.log("- %s", label.name);
    }
  }
}

function listFiltersByLabel() {
  var filters = Gmail.Users.Settings.Filters.list('me').filter;
  var labelsByName = getLabelIdsByName();
  for (label in labelsByName) {
    var found = [];
    for (var i = 0; i < filters.length; i++) {
      var filter = filters[i];
      if (!('query' in filter.criteria) || !('addLabelIds' in filter.action)) {
        continue;
      }
      var labelIds = filter.action.addLabelIds;
      for (j in labelIds) {
        if (labelIds[j] == labelsByName[label]) {
          found.push(filter);
          break;
        }
      }
    }

    if (found.length) {
      Logger.log(label);
      for (var i = 0; i < found.length; i++) {
        Logger.log('>> ' + found[i].criteria.query);
      }
    }
  }
}

function gmailFilters() {
  var allMessages = [];
  var labelsByName = getLabelIdsByName();
  Logger.log('starting bugzilla filter')
  // replace the second argument with 'STARRED' to use star instead of an "unprocessed" label
  doBugzilla(labelsByName, labelsByName['unprocessed'], allMessages, "bugzilla");
  Logger.log('starting mailing list filter')
  doMailingListsToFolder(allMessages, labelsByName['unprocessed'], 'INBOX', 'to:me');
  Logger.log('processed ' + allMessages.length + ' messages')
  removeLabelFromMessages(allMessages, labelsByName['unprocessed']);
  Logger.log('starting patch filter')
  if ('INBOX/patch' in labelsByName) {
    doInboxPatches(labelsByName, 'INBOX/patch');
  }
  Logger.log('done')
}
