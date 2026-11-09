#!/usr/bin/env python3
"""Exercise the Java transport and real PhpStorm document save extension in isolated paths."""
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

root = Path(__file__).resolve().parent
project = root.parent
ide = Path(os.environ.get('PHPSTORM_HOME', '/Applications/PhpStorm.app/Contents'))
if (ide / 'Contents').is_dir(): ide = ide / 'Contents'
java = ide / 'jbr/Contents/Home/bin'
temporary = Path(tempfile.mkdtemp(prefix='filebridge-phpstorm-', dir='/private/tmp'))
server_root = temporary / 'server'
(server_root / 'public_html').mkdir(parents=True)
(server_root / 'public_html/hello.txt').write_text('hello')
children = []
python = os.environ.get('REMOTER_TEST_PYTHON', '/private/tmp/remoter-fs-test-venv/bin/python')

def certificate(name):
    cert, key = temporary / (name+'.pem'), temporary / (name+'.key')
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
      '-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-out',str(cert),'-keyout',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    cert.write_bytes(cert.read_bytes()+key.read_bytes())
    return cert

def server(cert=''):
    child = subprocess.Popen([python,str(project/'test/ftp-server.py'),str(server_root),str(cert)],stdout=subprocess.PIPE,stderr=open(temporary/'ftp.log','ab'))
    children.append(child)
    return json.loads(child.stdout.readline())['port']

try:
    cert = certificate('trusted')
    trust = temporary / 'trust.p12'
    subprocess.run([str(java/'keytool'),'-importcert','-noprompt','-alias','fixture','-file',str(cert),'-keystore',str(trust),'-storepass','changeit'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    fixture = {'root':str(server_root),'port':server(),'tlsPort':server(cert),'badTlsPort':server(certificate('untrusted')),'report':str(temporary/'native-report.txt')}
    fixture_path = temporary/'fixture.json'; fixture_path.write_text(json.dumps(fixture))
    tests = root/'build/test-classes'; tests.mkdir(parents=True,exist_ok=True)
    cp = os.pathsep.join([str(root/'build/classes'),str(root/'lib/commons-net-3.13.0.jar'),str(ide/'lib/*')])
    subprocess.run([str(java/'javac'),'-encoding','UTF-8','-cp',cp,'-d',str(tests),*map(str,(root/'src/test/java').rglob('*.java'))],check=True)
    classpath = str(tests)+os.pathsep+cp
    subprocess.run([str(java/'java'),'-Djavax.net.ssl.trustStore='+str(trust),'-Djavax.net.ssl.trustStorePassword=changeit','-cp',classpath,
      'com.webobscure.filebridge.TransportChecks',str(fixture_path)],check=True)
    if '--transport-only' in sys.argv:
        raise SystemExit(0)
    plugin = temporary/'plugins/filebridge/lib'; plugin.mkdir(parents=True)
    shutil.copyfile(root/'lib/commons-net-3.13.0.jar',plugin/'commons-net.jar')
    with zipfile.ZipFile(root/'build/filebridge.jar') as original, zipfile.ZipFile(plugin/'filebridge.jar','w',zipfile.ZIP_DEFLATED) as patched:
        for info in original.infolist():
            data=original.read(info.filename)
            if info.filename=='META-INF/plugin.xml':
                data=data.replace(b'</extensions>',b'<appStarter id="filebridge-test" implementation="com.webobscure.filebridge.IntegrationStarter"/></extensions>')
            patched.writestr(info,data)
        for source in tests.rglob('*.class'): patched.write(source,source.relative_to(tests))
    options=temporary/'test.vmoptions'
    options.write_text((ide/'bin/phpstorm.vmoptions').read_text()+'\n'+ '\n'.join([
      '-Djava.awt.headless=true','-Didea.config.path='+str(temporary/'config'),'-Didea.system.path='+str(temporary/'system'),
      '-Didea.plugins.path='+str(temporary/'plugins'),'-Didea.log.path='+str(temporary/'log'),
      '-Djavax.net.ssl.trustStore='+str(trust),'-Djavax.net.ssl.trustStorePassword=changeit',
      '-Dide.no.platform.update=true','-Djb.consents.confirmation.enabled=false'])+'\n')
    env=dict(os.environ,PHPSTORM_VM_OPTIONS=str(options))
    with open(temporary/'ide-output.log','w') as log:
        result=subprocess.run([str(ide/'MacOS/phpstorm'),'filebridge-test',str(fixture_path)],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
    if result.returncode != 0:
        print((temporary/'ide-output.log').read_text()[-9000:])
        raise SystemExit('Native IDE checks failed: '+str(temporary))
    if not Path(fixture['report']).exists(): raise SystemExit('Native test starter did not produce a report: '+str(temporary))
    print(Path(fixture['report']).read_text())
finally:
    for child in children: child.terminate()
    print('Test artifacts:',temporary)
