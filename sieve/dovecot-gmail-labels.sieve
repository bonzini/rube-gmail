# the big ugly conversion from labels to folders
# put this file in ~/sieve/dovecot-gmail-labels.sieve
#
# Author: Paolo Bonzini <pbonzini@redhat.com>
# License: AGPLv3

require ["imap4flags", "regex", "fileinto", "variables", "mailbox", "include"];

# default values for global arguments
if string :is "${global.sentmail}" "" {
  set "global.sentmail" "Sent Mail";
}
if string :is "${global.myname}" "" {
  set "global.myname" "nonexistent@example.com";
}
if string :is "${global.respectinbox}" "" {
  set "global.respectinbox" "y";
}

# first of all, file into sent mail and inbox
if header :contains "x-gmail-labels" "\\Sent" {
  fileinto "${global.sentmail}";
}
if string :is "${global.respectinbox}" "y" {
  if header :contains "x-gmail-labels" "\\Inbox" {
    keep;
  }
}

# add spaces to the sides to facilitate matching words
if header :matches "x-gmail-labels" "*" {
  set "labels" " ${1} ";
}

# look for a user label
# syntax for labels: folder.subfolder.subfolder[/flag]
if not string :regex "${labels}" "[ \"][^\\\\]"  {
  return;
}

# detect messages sent to the user and put them in the inbox.
# messages resulting from import should not have the \Star flag
# for this to work properly.
if header :contains "x-gmail-labels" "\\Star" {
  # to detect bcc, use the fact that gmail dedup keeps the first
  # received copy of the message.  hopefully mailing list delivery
  # introduces enough delay that the first copy is the direct one,
  # that doesn't have list-id.  this is just best effort.
  if anyof (
      not exists "list-id",
      address :is "to" "${global.myname}",
      address :is "cc" "${global.myname}") {
    keep;
  }
}

# now file into all requested folders
set "re_extract" "^ (\"[^\"]*\"|[^ ]+)(.*)";
set "re_unquote" "^\"([^\"]*)\"$";

# to avoid filing into the same folder multiple times
set "filed_into" "";

# 16 instances of the same conditional, thus supporting up to 16
# labels.  only the first instance is commented

# extract first label, possibly quoted.  leave the rest in ${labels}
if string :regex "${labels}" "${re_extract}" {       # 1
  set "this_label" "${1}";
  set "labels" "${2}";

  # remove quotes if needed
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  # discard internal labels
  if not string :matches "${this_label}" "\\\\*" {
    # extract and apply flag, drop it from ${this_label}
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    # file into required mailbox with no duplicates
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 2
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 3
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 4
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 5
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 6
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 7
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 8
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 9
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 10
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 11
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 12
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 13
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 14
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 15
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }

if string :regex "${labels}" "${re_extract}" {       # 16
  set "this_label" "${1}";
  set "labels" "${2}";
  if string :regex "${this_label}" "${re_unquote}" {
    set "this_label" "${1}";
  }
  if not string :matches "${this_label}" "\\\\*" {
    if string :matches "${this_label}" "*/*" {
      addflag "${2}";
      set "this_label" "${1}";
    }
    if not string :contains " ${filed_into} " " ${this_label} " {
      fileinto :create "${this_label}";
      set "filed_into" "${filed_into} ${this_label}";
    }
  }
} else { return; }
