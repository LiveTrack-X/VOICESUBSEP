"""Keep the source-only runtime out of default installers until its audit clears."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

import pytest


ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / 'scripts' / 'build-backend.ps1'


def test_qwen_dependencies_are_opt_in_without_changing_default_diarization():
    project = tomllib.loads((ROOT / 'backend' / 'pyproject.toml').read_text(encoding='utf-8'))['project']
    extras = project['optional-dependencies']
    for name in ('soynlp', 'nagisa', 'DyNet38'):
        assert any(value.startswith(name + '==') for value in extras['qwen'])
        assert not any(value.startswith(name) for value in extras['diarization'])
    assert any(value.startswith('transformers @') for value in extras['qwen'])


def test_default_frozen_build_explicitly_excludes_qwen_and_ambiguous_dependency():
    build = BUILD.read_text(encoding='utf-8')
    for name in ('voicesubsep.qwen_asr', 'voicesubsep.qwen_model_cache', 'transformers.models.qwen3_asr',
                 'soynlp', 'nagisa', 'nagisa_utils', 'dynet', '_dynet', 'dynet_config'):
        assert "'--exclude-module', '" + name + "'" in build
    assert "'--collect-all', 'soynlp'" not in build


@pytest.mark.skipif(not shutil.which('powershell'), reason='Windows PowerShell is unavailable')
def test_explicit_qwen_bundle_request_stops_before_build_or_dependency_probes():
    result = subprocess.run(['powershell', '-NoProfile', '-File', str(BUILD), '-IncludeQwenRuntime',
                             '-CheckDependenciesOnly'], capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    assert 'Qwen desktop bundling is blocked' in result.stdout + result.stderr
    assert 'soynlp' in result.stdout + result.stderr


def test_dynet_fallback_notice_is_exact_upstream_copy_and_version_bound():
    path = ROOT / 'third-party/DyNet38-2.2/LICENSE.txt'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == '08aded6d3bf7635e55b2f6f15d13fd442afd7069826bf7dc52f57824c7f08625'
    build = BUILD.read_text(encoding='utf-8')
    code = re.search(r"\$inventoryCode = @'\r?\n(.*?)\r?\n'@", build, re.S).group(1)
    # Use metadata fixtures so even machines without optional dependencies
    # exercise the actual inventory program embedded in the build script.
    prefix = '''import importlib.metadata as metadata
from types import SimpleNamespace
metadata.distribution=lambda name: SimpleNamespace(version='2.2', files=[])
'''
    result = subprocess.run([sys.executable, '-c', prefix + code, str(ROOT), 'DyNet38'],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    entry = json.loads(result.stdout)[0]
    assert entry['fallback'] is True
    assert entry['relative'] == 'third-party/DyNet38-2.2/LICENSE.txt'
    # A missing soynlp notice is deliberately NOT given an automatic fallback.
    result = subprocess.run([sys.executable, '-c', prefix + code, str(ROOT), 'soynlp'],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert 'Missing original license files for soynlp' in result.stderr
