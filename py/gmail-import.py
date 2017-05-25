# gmail-import.py
#
# Import mboxes or Maildirs to GMail.  Each message passes through
# the filters that have been set on the remote server.  INBOX and
# STARRED can be forced on or off, and arbitrary labels can be added.
#
# The intended flow for Google Apps Scripts filters is:
# - disable mailing list filter trigger in Google Apps Scripts
# - import each folder except for the INBOX, using --never_star for all
#   folders except Bugzilla mail; --never_star lets you skip the
#   mailing list filter on imported messages.  No other flags should
#   be needed, because the remote filters will e.g. categorize mailing
#   list messages appropriately.
# - import the INBOX, this time passing --inbox --never_star
# - re-enable mailing list filter trigger in Google Apps Scripts
#
# The intended flow for getmail+dovecot+sieve is:
# - ensure getmail is not running, and that any cron job is disabled
# - import each folder except for the INBOX using --never_star.  The
#   Bugzilla exception does not apply in this case, because Bugzilla
#   does not suffer from dedup and can be filtered entirely in sieve.
# - import the INBOX, this time passing --inbox --never_star
# - download all mail locally using getmail
#
# Author: Paolo Bonzini <pbonzini@redhat.com>
# License: AGPLv3

from __future__ import print_function
import httplib2
import os, sys, io
import argparse
import mailbox

try:
    from googleapiclient import discovery
    from googleapiclient.http import MediaIoBaseUpload
    import oauth2client.tools
    import oauth2client.file
    import oauth2client.client
except:
    print("""Please install googleapiclient:
       pip install --upgrade google-api-python-client
""", file=sys.stderr)
    sys.exit(1)

def get_credentials(client_secret_file, credentials_file, scopes, user_agent, args=None):
    """Gets valid user credentials from storage.

    If nothing has been stored, or if the stored credentials are invalid,
    the OAuth2 flow is completed to obtain the new credentials.

    Returns:
        Credentials, the obtained credential.
    """
    store = oauth2client.file.Storage(credentials_file)
    credentials = store.get()
    if not credentials or credentials.invalid:
        flow = oauth2client.client.flow_from_clientsecrets(client_secret_file, scopes)
        flow.user_agent = user_agent
        if args:
            credentials = oauth2client.tools.run_flow(flow, store, args)
        else: # Needed only for compatibility with Python 2.6
            credentials = oauth2client.tools.run(flow, store)
        print('Storing credentials to ' + credentials_file)
    return credentials



# If modifying these scopes, delete your previously saved credentials
# at ~/.credentials/gmail-python-import.json
SCOPES = ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.insert']
HOME = os.path.expanduser('~')
CREDENTIALS = os.path.join(HOME, '.credentials')
CREDENTIALS_FILE = os.path.join(CREDENTIALS, 'gmail-python-import.json')
APPLICATION_NAME = 'GMail Import'

def import_one(service, data, body, num_retries=10):
    media = MediaIoBaseUpload(data, mimetype='message/rfc822', chunksize = 1024*256, resumable=True)
    metadata_object = {}
    message_response = service.users().messages().import_(
              userId='me',
              fields='id',
              neverMarkSpam=True,
              processForCalendar=False,
              internalDateSource='dateHeader',
              body=metadata_object,
              media_body=media).execute(num_retries=num_retries)
    message_response = service.users().messages().modify(userId='me',id=message_response['id'],
                body=body).execute(num_retries=num_retries)

def main():
    parser = argparse.ArgumentParser(
        description='Import an mbox or Maildir to GMail',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        parents=[oauth2client.tools.argparser],
        epilog="""To retrieve the client secrets file for --json, follow the instructions at
https://developers.google.com/gmail/api/quickstart/python.""")
    parser.add_argument('--json', required=True,
                        help='Path to the client secrets file from https://console.developers.google.com')
    parser.add_argument('--inbox', action='store_true', default=False,
                        help='Forcibly set INBOX label for messages')
    parser.add_argument('--star', action='store_true', default=False,
                        help='Forcibly set STAR for imported messages')
    parser.add_argument('--never_star', action='store_true', default=False,
                        help='Forcibly unset STAR for imported messages')
    parser.add_argument('--skip_inbox', action='store_true', default=False,
                        help='Forcibly unset INBOX label for messages')
    parser.add_argument('--add_label', action='append', default=[],
                        help='Forcibly set given label on the message')
    parser.add_argument('--num_retries', default=10, type=int,
                        help='Maximum number of exponential backoff retries for failures (default: 10)')
    parser.add_argument('--from_message', default=1, type=int,
                        help='Message number to resume from (1-based)')
    parser.add_argument('--maildir', action='store_true',
                        help='Command-line arguments identify Maildir-format directories (default: mbox)')
    parser.add_argument('infile', nargs='*', default=['/dev/fd/0'],
                        help='Files to be converted')

    args = parser.parse_args()
    if args.inbox and args.skip_inbox:
        print('--inbox and --skip_inbox are mutually exclusive.', file=sys.stderr)
        sys.exit(1)
    if args.star and args.never_star:
        print('--star and --never_star are mutually exclusive.', file=sys.stderr)
        sys.exit(1)

    # Authenticate and get root service object
    if not os.path.exists(CREDENTIALS):
        os.makedirs(CREDENTIALS)

    credentials = get_credentials(args.json, CREDENTIALS_FILE, SCOPES, APPLICATION_NAME, args)
    http = credentials.authorize(httplib2.Http())
    service = discovery.build('gmail', 'v1', http=http)

    # Setup labels for the import service
    body = {}
    body['addLabelIds'] = []
    body['removeLabelIds'] = []
    if args.inbox:
        body['addLabelIds'].append('INBOX')
    if args.skip_inbox:
        body['removeLabelIds'].append('INBOX')
    if args.star:
        body['addLabelIds'].append('STARRED')
    if args.never_star:
        body['removeLabelIds'].append('STARRED')

    # Convert label names to ids
    if len(args.add_label):
        results = service.users().labels().list(userId='me').execute()
        labels = results.get('labels', [])
        labelsByName = {}
        for label in labels:
             labelsByName[label['name']] = label['id']
        for labelName in args.add_label:
            body['addLabelIds'].append(labelsByName[labelName])

    # Go!
    index = 0
    for filename in args.infile:
        if args.maildir:
            mbox = mailbox.Maildir(filename, factory=None, create=False)
        else:
            mbox = mailbox.mbox(filename, create=False)
        for i, message in enumerate(mbox):
            index = index + 1
            if index < args.from_message:
                continue
            print("Processing message %d" % index)
            if sys.version_info.major == 2:
                data = io.BytesIO(message.as_string())
            else:
                data = io.StringIO(message.as_string())
            import_one(service, data, body, args.num_retries)


if __name__ == '__main__':
    main()
