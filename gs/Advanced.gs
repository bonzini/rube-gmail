// Sample Google Apps Script for filtering Bugzilla and mailing lists
// using the Google Apps Script advanced API
//
// Note: the Google Apps Script advanced API is experimental and must be
// enabled manually.  Unfortunately the simple API is not enough.  See
// https://developers.google.com/apps-script/guides/services/advanced
//
// Bugzilla filter
// ---------------
// This works together with a server filter like
//   from:bugzilla@redhat.com -> Skip inbox, star it, Apply label "bugzilla"
//
// There are three more labels nested under "bugzilla" ("closed", mine", "new")
// Starring the message makes it easy to do the heavier processing just once
// for each message.  Unfortunately it means you cannot use the star for your
// own business.  It should be possible to have an "unprocessed" label instead,
// but the star doesn't clutter the webmail screen so it's nicer in that
// respect.
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
// modify the "list:foo@bar.org" filter to also star the message.  For example:
//   list:qemu-devel@nongnu.org -> Skip inbox, star it, Apply label "qemu-devel"
//
// Such a filter can be created for example with
//   python gmail-filter.py --json /path/to/client_secret.json \
//        --create_list_filter qemu-devel@nongnu.org \
//        --star --skip_inbox --add_label qemu-devel
//
// This Javascript filter looks at GMail server side filters that have a
// "list:foo@bar.org" query and an "add label" action.  It then looks for
// starred messages with that label and detects those that should be in the
// inbox by two strategies:
//  - anything that has you in to/cc.   This does _not_ handle subscribing with
//    yourname+something@example.com.
//  - anything that has no List-id.  This works on the assumption that the
//    mailing list server introduces some delay, and you will get the direct
//    email first.  Because the first copy is the one that dedup uses, not
//    seeing List-id means (sufficient condition, but hopefully close enough
//    to necessary...) that you got a direct copy.
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

function doMailingListToInbox(labelName, unprocessedLabel, allMessages, toCcQuery) {
  var unprocessedQuery = unprocessedLabel == 'STARRED' ? 'is:starred' : 'label:unprocessed';
  var messages = searchMessages(unprocessedQuery + ' label:' + labelName + ' ' + toCcQuery);
  var messagesForInbox = [];
  for (i in messages) {
    var messageId = messages[i].id;
    allMessages.push(messageId);
    messagesForInbox.push(messageId);
  }

  messages = searchMessages(unprocessedQuery + ' label:' + labelName + ' -' + toCcQuery);
  var messagesForInbox = [];
  for (i in messages) {
    var messageId = messages[i].id
    var msg = getMessageById(messageId)
    if (!hasHeader(msg, 'list-id')) {
      messagesForInbox.push(messageId)
    }
    allMessages.push(messageId)
  }

  addLabelToMessages(messagesForInbox, 'INBOX');
}

function doMailingListsToInbox(allMessages, unprocessedLabel) {
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
      doMailingListToInbox(label.name, unprocessedLabel, allMessages, 'to:me');
    }
  }
}

function gmailFilters() {
  var allMessages = [];
  var labelsByName = getLabelIdsByName();
  Logger.log('starting bugzilla filter')
  doBugzilla(labelsByName, 'STARRED', allMessages, "bugzilla");
  Logger.log('starting mailing list filter')
  doMailingListsToInbox(allMessages, 'STARRED');
  Logger.log('processed ' + allMessages.length + ' messages')
  removeLabelFromMessages(allMessages, 'STARRED');
  Logger.log('done')
}
