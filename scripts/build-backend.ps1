[CmdletBinding()]
param([switch]$VerifyNoticesOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Run scripts/setup.ps1 first.' }
$ffmpegExe = (Get-Command ffmpeg -ErrorAction Stop).Source
$ffprobeExe = (Get-Command ffprobe -ErrorAction Stop).Source
$nvidiaRoot = Join-Path $projectRoot '.venv/Lib/site-packages/nvidia'
if (-not (Test-Path -LiteralPath $nvidiaRoot)) { throw 'Install the optional GPU runtime before building the desktop backend.' }

# Package data under nvidia/ does not include wheel .dist-info/licenses/.
# Keep the original distribution metadata, including license files, separately.
$nvidiaPackages = @('nvidia-cublas-cu12', 'nvidia-cudnn-cu12', 'nvidia-cuda-runtime-cu12', 'nvidia-cuda-nvrtc-cu12')
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
$inventoryJson = & $pythonExe -c $inventoryCode @nvidiaPackages
if ($LASTEXITCODE -ne 0) { throw 'GPU package license inventory failed; original notices are required.' }
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

Push-Location $projectRoot
try {
    $arguments = @('-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
        '--name', 'voicesubsep-server', '--contents-directory', '_internal', '--distpath', 'build/backend',
        '--workpath', 'build/pyinstaller', '--specpath', 'build', '--paths', 'backend',
        '--collect-all', 'faster_whisper', '--collect-all', 'ctranslate2',
        '--collect-all', 'onnxruntime', '--collect-all', 'av', '--collect-all', 'tokenizers',
        '--collect-submodules', 'uvicorn', '--collect-data', 'huggingface_hub',
        '--copy-metadata', 'faster-whisper', '--copy-metadata', 'voicesubsep',
        '--add-data', ($nvidiaRoot + ';nvidia'),
        '--add-binary', ($ffmpegExe + ';tools'), '--add-binary', ($ffprobeExe + ';tools'))
    foreach ($package in $nvidiaPackages) { $arguments += @('--copy-metadata', $package) }
    $arguments += $noticeArguments
    $arguments += 'backend/voicesubsep/desktop_server.py'
    if (-not $VerifyNoticesOnly) {
        & $pythonExe @arguments
        if ($LASTEXITCODE -ne 0) { throw "Backend bundling failed ($LASTEXITCODE)." }
    }
    $bundleInternal = Join-Path $projectRoot 'build/backend/voicesubsep-server/_internal'
    foreach ($notice in $noticeChecks) {
        $bundledFile = Join-Path $bundleInternal $notice.Relative
        if (-not (Test-Path -LiteralPath $bundledFile -PathType Leaf)) { throw "Bundled notice is missing: $bundledFile" }
        $sourceHash = (Get-FileHash -LiteralPath $notice.Source -Algorithm SHA256).Hash
        $bundleHash = (Get-FileHash -LiteralPath $bundledFile -Algorithm SHA256).Hash
        if ($sourceHash -ne $bundleHash) { throw "Bundled notice differs from its installed original: $bundledFile" }
    }
    Write-Host ("Original dependency notices preserved: {0} files (SHA256 verified)." -f $noticeChecks.Count)
    Write-Host 'Backend bundle: build/backend/voicesubsep-server'
} finally { Pop-Location }
