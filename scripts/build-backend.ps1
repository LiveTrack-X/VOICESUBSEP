[CmdletBinding()]
param([switch]$VerifyNoticesOnly, [switch]$CheckDependenciesOnly, [switch]$ReuseBuildCache)

$ErrorActionPreference = 'Stop'
if ($VerifyNoticesOnly -and $CheckDependenciesOnly) { throw 'Choose one verification mode.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run scripts/setup.ps1 first.' }
# CPython 3.12.0 code.replace() corrupts locals metadata when PyInstaller strips
# code paths; it can produce NameError in untouched torch/scipy module imports.
# Fixed in Python 3.12.1: https://github.com/python/cpython/pull/111866
$pythonCheck = @'
import sys
if sys.version_info[:3] == (3, 12, 0):
    raise SystemExit('Python 3.12.0 cannot build this desktop runtime. Use Python 3.12.1 or a newer supported maintenance release, then recreate the project virtual environment. No system Python replacement is required.')
'@
& $pythonExe -c $pythonCheck
if ($LASTEXITCODE -ne 0) { throw 'The project Python runtime is not suitable for a frozen desktop build.' }
$ffmpegExe = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobeExe = (Get-Command ffprobe -ErrorAction Stop).Source
$sitePackages = Join-Path $projectRoot '.venv/Lib/site-packages'
$nvidiaRoot = Join-Path $projectRoot '.venv/Lib/site-packages/nvidia'
$torchLib = Join-Path $sitePackages 'torch/lib'
$gpuInventoryCode = @'
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(sys.argv[1]) / 'backend'))
from voicesubsep.gpu_runtime import _WINDOWS_LIBRARIES
print(json.dumps(list(_WINDOWS_LIBRARIES)))
'@
$requiredCudaJson = & $pythonExe -c $gpuInventoryCode $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'CUDA dependency inventory failed.' }
$requiredCuda = $requiredCudaJson | ConvertFrom-Json
$missingTorchCuda = @(foreach ($library in $requiredCuda) {
    if (-not (Test-Path -LiteralPath (Join-Path $torchLib $library) -PathType Leaf)) { $library }
})
$useTorchCuda = $missingTorchCuda.Count -eq 0
if (-not $useTorchCuda -and -not (Test-Path -LiteralPath $nvidiaRoot)) {
    throw 'CUDA DLLs are missing from torch/lib and the optional NVIDIA runtime is unavailable.'
}

# The PyInstaller torch hook already includes torch/lib. Reuse those CUDA DLLs
# for CTranslate2 when the entire runtime probe set is present; do not copy a
# second, potentially different cuBLAS/cuDNN runtime from nvidia/.
$nvidiaPackages = @()
if (-not $useTorchCuda) {
    $nvidiaPackages = @('nvidia-cublas-cu12', 'nvidia-cudnn-cu12', 'nvidia-cuda-runtime-cu12', 'nvidia-cuda-nvrtc-cu12')
}
$runtimePackages = @('torch', 'transformers', 'librosa', 'numba', 'llvmlite', 'scipy', 'soundfile', 'soxr', 'safetensors', 'numpy')
$noticePackages = $runtimePackages + $nvidiaPackages
# These imports are lazy or selected by the model's processor_config.json.
# Do not collect all transformers models or model-conversion utilities.
$nemotronModules = @(
    'transformers.models.nemotron3_diarization.configuration_nemotron3_diarization',
    'transformers.models.nemotron3_diarization.modeling_nemotron3_diarization',
    'transformers.models.nemotron3_diarization.processing_nemotron3_diarization',
    'transformers.models.nemotron_asr_streaming.feature_extraction_nemotron_asr_streaming',
    'transformers.models.auto.feature_extraction_auto'
)
foreach ($module in $nemotronModules) {
    $moduleFile = Join-Path $sitePackages ($module.Replace('.', '/') + '.py')
    if (-not (Test-Path -LiteralPath $moduleFile -PathType Leaf)) {
        throw "Required Nemotron runtime module is missing: $module. See docs/MODEL-SETUP.md."
    }
}
# Preserve original distribution metadata and licenses, including CUDA notices
# supplied by the actual torch wheel rather than unrelated NVIDIA wheel versions.
$inventoryCode = @'
import importlib.metadata as metadata
import json
from pathlib import Path
import sys
records = []
for name in sys.argv[1:]:
    distribution = metadata.distribution(name)
    files = [file for file in (distribution.files or [])
             if '.dist-info' in str(file) and
             ('licenses' in file.parts or file.name.lower().startswith(('license', 'copying', 'notice')))]
    if not files:
        raise RuntimeError('Missing original license files for ' + name)
    for file in files:
        source = Path(distribution.locate_file(file)).resolve()
        if not source.is_file():
            raise RuntimeError('Missing installed license file: ' + str(source))
        records.append({'package': name, 'version': distribution.version,
                        'source': str(source), 'relative': str(file)})
print(json.dumps(records))
'@
$inventoryJson = & $pythonExe -c $inventoryCode @noticePackages
if ($LASTEXITCODE -ne 0) { throw 'Runtime package license inventory failed; original notices are required.' }
$inventoryRecords = $inventoryJson | ConvertFrom-Json
# Windows PowerShell 5.1 emits the JSON array as one pipeline object. A language
# foreach explicitly enumerates it so each check has one source and child path.
$noticeChecks = @(foreach ($record in $inventoryRecords) {
    [PSCustomObject]@{ Source = [string]$record.source; Relative = [string]$record.relative }
})

function Find-ToolNotices([string]$Executable) {
    $binaryDirectory = Split-Path -Parent $Executable
    $candidates = @($binaryDirectory, (Split-Path -Parent $binaryDirectory))
    foreach ($directory in $candidates) {
        $files = @(Get-ChildItem -LiteralPath $directory -File | Where-Object {
            $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|README|AUTHORS)([._-].*)?$'
        })
        $hasLicense = @($files | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING)([._-].*)?$' }).Count -gt 0
        $hasReadme = @($files | Where-Object { $_.Name -match '^README([._-].*)?$' }).Count -gt 0
        if ($hasLicense -and $hasReadme) {
            return [PSCustomObject]@{ Directory = $directory; Files = $files }
        }
    }
    throw "Original LICENSE/COPYING and README were not found next to $Executable or in its install root."
}

$noticeArguments = @()
$noticeDirectories = @{}
foreach ($tool in @(
    [PSCustomObject]@{ Name = 'ffmpeg'; Executable = $ffmpegExe },
    [PSCustomObject]@{ Name = 'ffprobe'; Executable = $ffprobeExe }
)) {
    $notices = Find-ToolNotices $tool.Executable
    if (-not $noticeDirectories.ContainsKey($notices.Directory)) {
        $noticeDirectories[$notices.Directory] = $true
        $destination = 'third-party/' + $tool.Name
        foreach ($file in $notices.Files) {
            $noticeArguments += @('--add-data', ($file.FullName + ';' + $destination))
            $noticeChecks += [PSCustomObject]@{ Source = $file.FullName; Relative = ($destination + '/' + $file.Name) }
        }
    }
}
$bundleNotice = Join-Path $projectRoot 'docs/BUNDLED-NOTICES.md'
if (-not (Test-Path -LiteralPath $bundleNotice)) { throw 'docs/BUNDLED-NOTICES.md is required.' }
$noticeArguments += @('--add-data', ($bundleNotice + ';third-party'))
$noticeChecks += [PSCustomObject]@{ Source = $bundleNotice; Relative = 'third-party/BUNDLED-NOTICES.md' }
$soundfileNotice = Join-Path $sitePackages '_soundfile_data/COPYING'
if (Test-Path -LiteralPath $soundfileNotice -PathType Leaf) {
    $noticeChecks += [PSCustomObject]@{ Source = $soundfileNotice; Relative = '_soundfile_data/COPYING' }
}
# llvmlite 0.49 Windows wheels add a sibling delvewheel DLL directory that the
# installed hook-llvmlite (package-local collect_dynamic_libs) does not include.
$nativeArguments = @()
$nativeChecks = @()
$llvmliteSidecar = Join-Path $sitePackages 'llvmlite.libs'
if (Test-Path -LiteralPath $llvmliteSidecar -PathType Container) {
    foreach ($file in (Get-ChildItem -LiteralPath $llvmliteSidecar -File)) {
        $kind = if ($file.Extension -eq '.dll') { '--add-binary' } else { '--add-data' }
        $nativeArguments += @($kind, ($file.FullName + ';llvmlite.libs'))
        $nativeChecks += [PSCustomObject]@{ Source = $file.FullName; Relative = ('llvmlite.libs/' + $file.Name) }
    }
}

if ($CheckDependenciesOnly) {
    Write-Host ("Nemotron runtime modules present: {0}; original notice files: {1}." -f $nemotronModules.Count, $noticeChecks.Count)
    if ($useTorchCuda) { Write-Host 'CUDA source: torch/lib (NVIDIA package DLLs will not be duplicated).' }
    else { Write-Host 'CUDA source: separate NVIDIA packages (torch/lib is incomplete).' }
    return
}

Push-Location $projectRoot
try {
    $hookDirectory = Join-Path $projectRoot 'build/pyinstaller-hooks'
    if (-not $VerifyNoticesOnly) {
        New-Item -ItemType Directory -Path $hookDirectory -Force | Out-Null
        # Preserve the installed standard hook's metadata and source-file rules,
        # then limit models referenced by Transformers' TYPE_CHECKING branches.
        # The exclusions apply to this package and its children, not other apps.
        $transformersHook = @'
from pathlib import Path
import runpy
import _pyinstaller_hooks_contrib
from PyInstaller.utils.hooks import get_package_paths

standard = runpy.run_path(str(Path(_pyinstaller_hooks_contrib.__file__).parent / 'stdhooks' / 'hook-transformers.py'))
datas = standard.get('datas', [])
module_collection_mode = standard.get('module_collection_mode', 'pyz+py')
allowed = {'auto', 'nemotron3_diarization', 'nemotron_asr_streaming'}
# The pinned Transformers release imports GGUF tokenizer mappings from generic
# model-loading code, even for a safetensors audio model. Include these six
# tokenizer modules, but not their unrelated language-model implementations.
support = {name: 'tokenization_' + name for name in ('gemma', 'gpt2', 'llama', 'qwen2', 'qwen3_5', 't5')}
# AutoTokenizer imports this config from its module body. No encoder/decoder
# model implementation is required by the audio-only application.
support['encoder_decoder'] = 'configuration_encoder_decoder'
models = Path(get_package_paths('transformers')[1]) / 'models'
excludedimports = []
hiddenimports = ['transformers.models.' + name + '.' + module for name, module in sorted(support.items())]
for path in models.iterdir():
    if not path.is_dir() or not (path / '__init__.py').is_file() or path.name in allowed:
        continue
    if path.name not in support:
        excludedimports.append('transformers.models.' + path.name)
        continue
    for module in path.glob('*.py'):
        if module.stem not in {'__init__', support[path.name]}:
            excludedimports.append('transformers.models.' + path.name + '.' + module.stem)
'@
        [System.IO.File]::WriteAllText((Join-Path $hookDirectory 'hook-transformers.py'), $transformersHook, [System.Text.UTF8Encoding]::new($false))
    }
    $arguments = @('-m', 'PyInstaller', '--noconfirm', '--onedir',
        '--name', 'voicesubsep-server', '--contents-directory', '_internal', '--distpath', 'build/backend',
        '--workpath', 'build/pyinstaller', '--specpath', 'build', '--paths', 'backend', '--additional-hooks-dir', $hookDirectory,
        '--collect-all', 'faster_whisper', '--collect-data', 'ctranslate2', '--collect-binaries', 'ctranslate2',
        '--exclude-module', 'ctranslate2.converters', '--exclude-module', 'ctranslate2.specs',
        '--collect-all', 'onnxruntime', '--collect-all', 'av', '--collect-all', 'tokenizers',
        '--collect-submodules', 'uvicorn', '--collect-data', 'huggingface_hub',
        '--copy-metadata', 'faster-whisper', '--copy-metadata', 'voicesubsep',
        '--recursive-copy-metadata', 'torch', '--recursive-copy-metadata', 'transformers', '--recursive-copy-metadata', 'librosa',
        '--add-binary', ($ffmpegExe + ';tools'), '--add-binary', ($ffprobeExe + ';tools'))
    if (-not $ReuseBuildCache) { $arguments += '--clean' }
    # Standard hooks handle torch DLLs/source, librosa lazy-loader .pyi/data,
    # llvmlite DLLs, scipy.libs and soundfile's libsndfile. No collect-all torch
    # or transformers pass is needed on top of those hooks.
    foreach ($module in (@('torch', 'librosa', 'numba', 'llvmlite', 'scipy', 'soundfile', 'soxr', 'safetensors') + $nemotronModules)) {
        $arguments += @('--hidden-import', $module)
    }
    foreach ($package in $noticePackages) { $arguments += @('--copy-metadata', $package) }
    if (-not $useTorchCuda) { $arguments += @('--add-data', ($nvidiaRoot + ';nvidia')) }
    $arguments += $noticeArguments
    $arguments += $nativeArguments
    $arguments += 'backend/voicesubsep/desktop_server.py'
    if (-not $VerifyNoticesOnly) {
        & $pythonExe @arguments
        if ($LASTEXITCODE -ne 0) { throw "Backend bundling failed ($LASTEXITCODE)." }
    }
    $bundleInternal = Join-Path $projectRoot 'build/backend/voicesubsep-server/_internal'
    if ($useTorchCuda) {
        foreach ($library in $requiredCuda) {
            $bundledLibrary = Join-Path $bundleInternal ('torch/lib/' + $library)
            if (-not (Test-Path -LiteralPath $bundledLibrary -PathType Leaf)) { throw "Bundled CUDA library is missing: $bundledLibrary" }
            if ((Get-Item -LiteralPath $bundledLibrary).Length -ne (Get-Item -LiteralPath (Join-Path $torchLib $library)).Length) {
                throw "Bundled CUDA library size differs from its installed original: $bundledLibrary"
            }
        }
    }
    foreach ($library in $nativeChecks) {
        $bundledLibrary = Join-Path $bundleInternal $library.Relative
        if (-not (Test-Path -LiteralPath $bundledLibrary -PathType Leaf)) { throw "Bundled native sidecar is missing: $bundledLibrary" }
        if ((Get-Item -LiteralPath $bundledLibrary).Length -ne (Get-Item -LiteralPath $library.Source).Length) {
            throw "Bundled native sidecar size differs from its installed original: $bundledLibrary"
        }
    }
    foreach ($notice in $noticeChecks) {
        $bundledFile = Join-Path $bundleInternal $notice.Relative
        if (-not (Test-Path -LiteralPath $bundledFile -PathType Leaf)) { throw "Bundled notice is missing: $bundledFile" }
        $sourceHash = (Get-FileHash -LiteralPath $notice.Source -Algorithm SHA256).Hash
        $bundleHash = (Get-FileHash -LiteralPath $bundledFile -Algorithm SHA256).Hash
        if ($sourceHash -ne $bundleHash) { throw "Bundled notice differs from its installed original: $bundledFile" }
    }
    Write-Host ("Original dependency notices preserved: {0} files (SHA256 verified)." -f $noticeChecks.Count)
    if (-not $VerifyNoticesOnly) {
        $runtimeGate = Join-Path $projectRoot 'scripts/bundled-runtime-check.py'
        if (-not (Test-Path -LiteralPath $runtimeGate -PathType Leaf)) { throw 'The bundled runtime verification script is required.' }
        & $pythonExe $runtimeGate --output (Join-Path $projectRoot 'tmp/bundled-runtime-check.json')
        if ($LASTEXITCODE -ne 0) { throw 'The frozen backend failed its required offline engine-readiness/shutdown check. See tmp/bundled-runtime-check.json.' }
    }
    Write-Host 'Backend bundle: build/backend/voicesubsep-server'
} finally { Pop-Location }
