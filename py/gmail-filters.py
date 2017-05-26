# gmail-filters.py
#
# Uses the GMail API to remotely manipulate filters for
# mailing lists and the corresponding labels.
#
# Author: Paolo Bonzini <pbonzini@redhat.com>
# License: AGPLv3

from __future__ import print_function
import httplib2
import os, sys, io
import argparse, copy
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
SCOPES = ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.settings.basic']
HOME = os.path.expanduser('~')
CREDENTIALS = os.path.join(HOME, '.credentials')
CREDENTIALS_FILE = os.path.join(CREDENTIALS, 'gmail-python-filters.json')
APPLICATION_NAME = 'GMail Import'

class AppendAllAction(argparse.Action):
    def __init__(self, option_strings, dest, nargs=None, default=[], **kwargs):
        if nargs is None:
            nargs = '+'
        if nargs != '+' and nargs != '*':
            raise ValueError("nargs must be + or *")
        super(AppendAllAction, self).__init__(option_strings, dest,
                                              default=copy.copy(default),
                                              nargs=nargs, **kwargs)
    def __call__(self, parser, namespace, values, option_string=None):
        items = getattr(namespace, self.dest, None)
        if items is None:
            items = []
            setattr(namespace, self.dest, items)
        for value in values:
            items.append(value)

class StoreOnceAction(argparse.Action):
    def __init__(self, option_strings, dest, nargs=None, **kwargs):
        if nargs is not None:
            raise ValueError("nargs not allowed")
        self.found = False
        super(StoreOnceAction, self).__init__(option_strings, dest,
                                              nargs=None, **kwargs)
    def __call__(self, parser, namespace, values, option_string):
        if self.found:
            raise ValueError("cannot repeat " + option_string)
        self.found = True
        items = getattr(namespace, self.dest, None)
        setattr(namespace, self.dest, values)

def main():
    parser = argparse.ArgumentParser(
        description='Manipulate labels and filters of a GMail account',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        parents=[oauth2client.tools.argparser],
        epilog="""Specifying the same label in both --create_labels and --delete_labels
will remove the label from all messages.

To retrieve the client secrets file for --json, follow the instructions at
https://developers.google.com/gmail/api/quickstart/python.""")
    parser.add_argument('--json', required=True,
                        help='Path to the client secrets file from https://console.developers.google.com')
    parser.add_argument('--dry_run', action='store_true', default=False,
                        help='Do not actually do anything')
    parser.add_argument('--create_labels', action=AppendAllAction, nargs='+',
                        help='Create the given labels', metavar='LABEL')
    parser.add_argument('--hidden', action='store_true',
                        help='Hide the created labels from the label and message list')
    parser.add_argument('--delete_labels', action=AppendAllAction, nargs='+',
                        help='Delete the given labels', metavar='LABEL')
    parser.add_argument('--create_list_filter', action=StoreOnceAction,
                        help='Create a filter on the given list', metavar='LIST-ADDRESS')
    parser.add_argument('--delete_list_filters', action=AppendAllAction,
                        help='Delete all filters on the given list', metavar='LIST-ADDRESS')
    parser.add_argument('--star', action='store_true', default=False,
                        help='Set STAR for messages matching the filter')
    parser.add_argument('--skip_inbox', action='store_true', default=False,
                        help='Unset INBOX label for messages matching the filter')
    parser.add_argument('--never_spam', action='store_true', default=False,
                        help='Never send messages matching the filter to spam')
    parser.add_argument('--add_labels', action=AppendAllAction, nargs='+',
                        help='Set given labels for messages matching the filter', metavar='LABEL')
    parser.add_argument('--num_retries', default=10, type=int,
                        help='Maximum number of exponential backoff retries for failures (default: 10)')

    # Validate argument combinations.
    args = parser.parse_args()
    if len(args.create_labels) + len(args.delete_labels) + \
          len(args.delete_list_filters) + \
          (args.create_list_filter is not None) == 0:
        print('No action specified.', file=sys.stderr)
        sys.exit(1)
    if (len(args.create_labels) + len(args.delete_labels) + len(args.delete_list_filters) > 0) and \
        (args.create_list_filter is not None):
        print('--create_list_filter cannot be combined with other actions.', file=sys.stderr)
        sys.exit(1)
    if (args.create_list_filter is None) and \
          (args.star + args.skip_inbox + args.never_spam + len(args.add_labels) > 0):
        print('--star, --skip_inbox, --never_spam and --add_labels can only be combined with --create_list_filter.', file=sys.stderr)

    # Authenticate and get root service object
    if not os.path.exists(CREDENTIALS):
        os.makedirs(CREDENTIALS)

    credentials = get_credentials(args.json, CREDENTIALS_FILE, SCOPES, APPLICATION_NAME, args)
    http = credentials.authorize(httplib2.Http())
    service = discovery.build('gmail', 'v1', http=http)

    # if we will have to convert label names to ids, make a map
    labelsByName = {}
    if len(args.delete_labels) or len(args.add_labels):
        results = service.users().labels().\
                      list(userId='me').\
                      execute(num_retries=args.num_retries)
        labels = results.get('labels', [])
        labelsByName = {}
        for label in labels:
             labelsByName[label['name']] = label['id']

    # --add_labels implies creating the missing labels
    for i in args.add_labels:
        if not (i in labelsByName):
            args.create_labels.append(i)

    if len(args.create_labels) == 0 and args.hidden:
        print('--hidden specified but no labels would be created.', file=sys.stderr)
        sys.exit(1)

    # Now execute the commands
    did_something = False
    if len(args.delete_labels):
        for i in args.delete_labels:
            if (i in labelsByName):
                if not args.dry_run:
                    print("Deleting label " + i + "...")
                    service.users().labels().\
                            delete(userId='me', id=labelsByName[i]).\
                            execute(num_retries=args.num_retries)
                    did_something = True
                else:
                    print("Would delete label " + i + ".")
                del labelsByName[i]
            else:
                print("Label %s does not exist." % i)

    if len(args.create_labels):
        for i in args.create_labels:
            if (i in labelsByName):
                print("Label %s already exists." % i)
            else:
                if not args.dry_run:
                    print("Creating label " + i + "...")
                    body = {'name': i}
                    if args.hidden:
                        body['messageListVisibility'] = 'hide'
                        body['labelListVisibility'] = 'labelHide'
                    label = service.users().labels().\
                                create(userId='me', body=body).\
                                execute(num_retries=args.num_retries)
                    did_something = True
                else:
                    print("Would create label " + i + ".")
                labelsByName[i] = label['id']

    if len(args.delete_list_filters):
        results = service.users().settings().filters().\
                      list(userId='me').\
                      execute(num_retries=args.num_retries)
        filters = results.get('filter', [])
        for listid in args.delete_list_filters:
            deleted = False
            for filt in filters:
                if ('query' in filt['criteria']) and \
                         filt['criteria']['query'] == ('list:' + listid):
                    if not args.dry_run:
                        print ("Deleting filter " + filt['id'] + " for list " + listid + "...")
                        service.users().settings().filters().\
                                delete(userId='me', id=filt['id']).\
                                execute(num_retries=args.num_retries)
                        did_something = True
                    else:
                        print ("Would delete filter " + filt['id'] + " for list " + listid + ".")
                    deleted = True
                    break
            if not deleted:
                print("No filter exists for list " + listid, file=sys.stderr)

    if args.create_list_filter is not None:
        if not args.dry_run:
            print("Creating filter on list:" + args.create_list_filter + "...")
            addLabelIds = [labelsByName[i] for i in args.add_labels]
            if args.star:
                addLabelIds.append('STARRED')
            removeLabelIds = []
            if args.skip_inbox:
                removeLabelIds.append('INBOX')
            if args.never_spam:
                removeLabelIds.append('SPAM')
            body = {'criteria': { 'query': 'list:' + args.create_list_filter },
                    'action': {
                        'addLabelIds': addLabelIds,
                        'removeLabelIds': removeLabelIds
                        }
                    }
            service.users().settings().filters().\
                    create(userId='me', body=body).\
                    execute(num_retries=args.num_retries)
            did_something = True
        else:
            print("Would create filter on list:" + args.create_list_filter + ".")

    if did_something:
        print("Completed!")

if __name__ == '__main__':
    main()
