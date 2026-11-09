#!/usr/bin/env python3
"""Build against an installed PhpStorm SDK; no system Java or Gradle is required."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

root = Path(__file__).resolve().parent
ide = Path(os.environ.get('PHPSTORM_HOME', '/Applications/PhpStorm.app/Contents'))
if (ide / 'Contents').is_dir():
    ide = ide / 'Contents'
java_home = Path(os.environ.get('JAVA_HOME', str(ide / 'jbr/Contents/Home')))
product = json.loads((ide / 'Resources/product-info.json').read_text())
if not product['buildNumber'].startswith('262.'):
    raise SystemExit('This first native build targets PhpStorm 2026.2 (build 262).')
dependency = root / 'lib/commons-net-3.13.0.jar'
dependency.parent.mkdir(exist_ok=True)
if not dependency.exists():
    urllib.request.urlretrieve('https://repo.maven.apache.org/maven2/commons-net/commons-net/3.13.0/commons-net-3.13.0.jar', dependency)
expected = '9e88444afadc9467f0bf3d328f93b9538da35a9be05cdee430766e64fddbd6c5'
if hashlib.sha256(dependency.read_bytes()).hexdigest() != expected:
    raise SystemExit('Apache Commons Net checksum mismatch.')
build = root / 'build'
classes = build / 'classes'
if classes.exists():
    shutil.rmtree(classes)
classes.mkdir(parents=True)
classpath = os.pathsep.join([str(ide / 'lib/*'), str(dependency)])
sources = sorted((root / 'src/main/java').rglob('*.java'))
subprocess.run([str(java_home / 'bin/javac'), '-encoding', 'UTF-8', '-classpath', classpath,
                '-d', str(classes), *map(str, sources)], check=True)
for source in (root / 'src/main/resources').rglob('*'):
    if source.is_file():
        target = classes / source.relative_to(root / 'src/main/resources')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
jar = build / 'filebridge.jar'
with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as archive:
    for source in classes.rglob('*'):
        if source.is_file():
            archive.write(source, source.relative_to(classes))
package = root.parent / 'filebridge-phpstorm-0.2.0.zip'
with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(jar, 'filebridge/lib/filebridge.jar')
    archive.write(dependency, 'filebridge/lib/commons-net-3.13.0.jar')
    archive.write(root.parent / 'LICENSE', 'filebridge/LICENSE.txt')
    archive.write(root / 'README.md', 'filebridge/README.md')
    archive.writestr('filebridge/NOTICE.txt', 'FileBridge by Webobscure. Based on the Remote FS editing workflow; see LICENSE.txt.\nApache Commons Net 3.13.0 is bundled under Apache License 2.0; see its META-INF/LICENSE.txt and NOTICE.txt.\n')
print('Built', package)
