// Sample Google Apps Script for filtering Bugzilla
// using the Google Apps Script simple API
//
// Note: This is just an example of using the API.  While it can provide
// decent results for the Bugzilla case, the Google Apps Script simple API
// is very limited; for example, it cannot apply labels per-message.  I
// suggest treating this as an example and only using Advanced.gs.
//
// Bugzilla filter
// ---------------
// This works together with a server filter like
//   from:bugzilla@redhat.com -> Skip inbox, star it, Apply label "bugzilla"
//
// There are three more labels nested under "bugzilla" ("closed", mine", "new")
// Starring the message makes it easy to do the heavier processing just once
// for each message.  Unfortunately it means you cannot use the star for your
// own business.
//
// Author: Paolo Bonzini <pbonzini@redhat.com>
// License: AGPLv3


/////////////////////////////////////////////////////////////////////////
// simple RFC2822 parser
/////////////////////////////////////////////////////////////////////////

function getHeaders(msg) {
  var headers = []
  for (var i = 0; i < msg.length; i = eol + 1) {
    if (msg.substr(i, 1) == '\n' || msg.substr(i, 2) == '\r\n') {
      break
    }
    
    var eol = msg.indexOf('\n', i)
    if (eol == -1) {
      eol = msg.length - 1;
    }

    var line = msg.slice(i, eol);
    if (line[line.length - 1] == '\r') {
      line = line.slice(0, -1);
    }
    headers.push(line)
  }
  return headers
}

function parseHeaders(msg) {
  var headers = getHeaders(msg);
  var result = {};
  var name;
  for (i in headers) {
    var header = headers[i]
    if (header[0] == ' ' || header[0] == '\t') {
      if (name != "") {
        headers[name] = headers[name] + header;
      }
    } else {
      var pos = header.indexOf(":");
      name = header.slice(0, pos).toLowerCase();
      if (header[pos + 1] == ' ') {
        pos++;
      }
      if (name != "") {
        headers[name] = header.slice(pos + 1);
      }
    }
  }
  return headers
}

/////////////////////////////////////////////////////////////////////////

function simpleGetBugzillaHeaders() {
  // test code
  function stringAt(haystack, str, i) {
    return haystack.substr(i, str.length) == str;
  }
  
  var threads = GmailApp.search('label:bugzilla');
  var message = threads[0].getMessages()[0];
  var headers = parseHeaders(message.getRawContent());
  for (k in headers) {
    if (stringAt(k, 'x-bugzilla-', 0)) Logger.log(k + ' "' + headers[k] + '"');
  }
}

function simpleBugzilla(label) {
  // the actual filter
  var threads = GmailApp.search('label:' + label + ' is:starred');
  var LABEL_MINE = GmailApp.getUserLabelByName(label + "/mine");
  var LABEL_CLOSED = GmailApp.getUserLabelByName(label + "/closed");
  var LABEL_NEW = GmailApp.getUserLabelByName(label + "/new");
  for (i in threads) {
    var thread = threads[i];
    var messages = thread.getMessages();
    for (j in messages) {
      var message = messages[j];
      if (!message.isStarred()) {
        continue;
      }
      
      var h = parseHeaders(message.getRawContent())
      if (h['x-bugzilla-type'] == 'new') {
        // threads are broken between the first message (with "New:" in it) and
        // the others.  this is awful, but at least it lets you use a label on
        // the specific message for newly-created bugs.
        thread.addLabel(LABEL_NEW);
      }

      if (h['x-bugzilla-status'] == 'CLOSED' || h['x-bugzilla-status'] == 'VERIFIED' || h['x-bugzilla-status'] == 'RELEASE_PENDING') {
        thread.addLabel(LABEL_CLOSED);
      } else {
        thread.removeLabel(LABEL_CLOSED);
      }
      if ('x-bugzilla-reason' in h) {
        var reason = h['x-bugzilla-reason'].toLowerCase();
        if (reason != 'none') {
          thread.addLabel(LABEL_MINE);
        } else {
          thread.removeLabel(LABEL_MINE);
        }
        if (reason.search('needinfo') != -1) {
          thread.moveToInbox();
        }
      }
      message.unstar();
    }
  }
}

function simpleBugzillaFilter() {
  simpleBugzilla("bugzilla")
}
