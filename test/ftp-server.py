"""Loopback-only integration fixture. Never connects to a user's server."""
import json
import os
import sys
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
from pyftpdlib.servers import FTPServer

root, cert = sys.argv[1:3]
base = TLS_FTPHandler if cert else FTPHandler

class Handler(base):
    def ftp_MLSD(self, path):
        marker = os.path.join(root, 'drop-next-listing')
        if os.path.exists(marker):
            os.unlink(marker)
            self.close()
            return
        return super().ftp_MLSD(path)

    # Exercise save failures without timing-dependent network races.
    def ftp_STOR(self, file, mode='w'):
        if os.path.exists(os.path.join(root, 'reject-upload')):
            self.respond('550 Upload rejected by test fixture')
            return
        return super().ftp_STOR(file, mode)

    def ftp_RNTO(self, path):
        if os.path.exists(os.path.join(root, 'reject-rename')):
            self.respond('550 Rename rejected by test fixture')
            return
        return super().ftp_RNTO(path)

authorizer = DummyAuthorizer()
authorizer.add_user('tester', 'test-password', root, perm='elradfmwMT')
authorizer.add_user('reader', 'test-password', root, perm='elr')
Handler.authorizer = authorizer
if cert:
    Handler.certfile = cert
    Handler.keyfile = cert
    Handler.tls_control_required = True
    Handler.tls_data_required = True
server = FTPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'port': server.socket.getsockname()[1]}), flush=True)
server.serve_forever()
