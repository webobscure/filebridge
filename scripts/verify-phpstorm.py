"""Verify the current native package against the configured SDK, without IDE licensing."""
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
ide = Path(os.environ.get('PHPSTORM_HOME', '/Applications/PhpStorm.app/Contents'))
if (ide / 'Contents').exists(): ide = ide / 'Contents'
bundled = ide / ('jbr/Contents/Home' if (ide/'jbr/Contents/Home').exists() else 'jbr')
java = Path(os.environ.get('JAVA_HOME', str(bundled))) / 'bin/java'
verifier = Path(os.environ.get('PLUGIN_VERIFIER_JAR', str(root/'.tools/verifier.jar')))
version = ET.parse(root/'jetbrains/src/main/resources/META-INF/plugin.xml').getroot().findtext('version')
subprocess.run([str(java), '-Dplugin.verifier.home.dir=' + str(root/'.tools/verifier-home'), '-jar', str(verifier),
    '-offline', '-verification-reports-dir', str(root/'test-results/plugin-verifier'), 'check-plugin',
    str(root/('filebridge-phpstorm-' + version + '.zip')), str(ide)], check=True)
