[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Require-Command([string]$Name) {
    $resolved = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $resolved) { throw "$Name is not on PATH. See README.md for prerequisites." }
    return $resolved.Source
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE." }
}

$uvExecutable = Require-Command 'uv'
$nodeExecutable = Require-Command 'node'
# .cmd avoids execution-policy restrictions on the npm.ps1 shim.
$npmExecutable = Require-Command 'npm.cmd'
$null = Require-Command 'ffmpeg'
$null = Require-Command 'ffprobe'
$nodeVersion = (& $nodeExecutable --version).TrimStart('v')
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Node.js version.' }
if ([version]$nodeVersion -lt [version]'22.12.0') {
    throw "Node.js 22.12 or newer is required by this setup (found $nodeVersion)."
}

if ($Check) {
    Write-Host "Prerequisites found: Node.js $nodeVersion, npm, uv, FFmpeg, FFprobe."
    Write-Host 'No packages or model weights were downloaded.'
    exit 0
}

Push-Location $projectRoot
try {
    $venvPath = Join-Path $projectRoot '.venv'
    $pythonExecutable = Join-Path $venvPath 'Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPath) {
        if (-not (Test-Path -LiteralPath $pythonExecutable)) {
            throw 'Existing .venv is not a Windows Python environment. Rename it before running setup.'
        }
        $pythonVersion = & $pythonExecutable -c 'import platform; print(platform.python_version())'
        if ($LASTEXITCODE -ne 0 -or [version]$pythonVersion.Trim() -lt [version]'3.12.1' -or [version]$pythonVersion.Trim() -ge [version]'3.13') {
            throw 'Existing .venv must use Python 3.12.1 or newer within 3.12. Python 3.12.0 has a frozen-module bug. Rename the old environment before setup; it was not modified.'
        }
    } else {
        Invoke-Checked $uvExecutable @('venv', '--python', '3.12.13', $venvPath)
    }
    # Speaker-aware subtitles are the default product, so a normal setup must
    # include the actual diarization runtime rather than an unusable checkbox.
    Invoke-Checked $uvExecutable @('pip', 'install', '--python', $pythonExecutable,
        'torch==2.11.0+cu128', '--index-url', 'https://download.pytorch.org/whl/cu128')
    Invoke-Checked $uvExecutable @('pip', 'install', '--python', $pythonExecutable, '--editable', './backend[whisper,diarization,test]')
    Invoke-Checked $npmExecutable @('ci')
    Write-Host ''
    Write-Host 'VOICESUBSEP is ready. Start: node scripts/dev.mjs'
    Write-Host 'Whisper and Nemotron runtimes installed. GPU and model checks: docs/MODEL-SETUP.md'
    Write-Host 'Model weights are downloaded separately on first analysis; setup does not download them.'
} finally {
    Pop-Location
}
