param([string]$OutputDirectory, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configText = Get-Content -LiteralPath (Join-Path $repo 'installer/ReleaseConfig.cs') -Raw
$versionMatch = [regex]::Match($configText, 'internal const string Version = "([0-9]+\.[0-9]+\.[0-9]+)";')
if (-not $versionMatch.Success) { throw 'Missing pinned online installer version.' }
$installerVersion = $versionMatch.Groups[1].Value
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repo "release/online-v$installerVersion" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required.' }
$frameworkRelease = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full').Release
if ($frameworkRelease -lt 528040) { throw '.NET Framework 4.8 or later is required.' }
$sources = Join-Path $repo 'installer'
$common = @('/nologo', '/optimize+', '/langversion:5', '/r:System.Net.Http.dll')
if (-not $SkipTests) {
    $testExe = Join-Path $OutputDirectory 'BootstrapCoreTests.exe'
    & $compiler @common '/target:exe' "/out:$testExe" (Join-Path $sources 'BootstrapCore.cs') (Join-Path $sources 'BootstrapCoreTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap test compilation failed.' }
    & $testExe
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap tests failed.' }
}
$output = Join-Path $OutputDirectory "VOICESUBSEP-$installerVersion-Online-Setup-x64.exe"
& $compiler @common '/target:winexe' '/platform:anycpu' '/r:System.Windows.Forms.dll' '/r:System.Drawing.dll' "/win32icon:$(Join-Path $repo 'desktop/assets/icon.ico')" "/win32manifest:$(Join-Path $sources 'app.manifest')" "/out:$output" (Join-Path $sources 'BootstrapCore.cs') (Join-Path $sources 'ReleaseConfig.cs') (Join-Path $sources 'Program.cs') (Join-Path $sources 'AssemblyInfo.cs')
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap compilation failed.' }
$smoke = Start-Process -FilePath $output -ArgumentList '--smoke' -WindowStyle Hidden -PassThru -Wait
if ($smoke.ExitCode -ne 0) { throw "Bootstrap UI smoke failed: $($smoke.ExitCode)" }
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
$checksum = "$hash  $([IO.Path]::GetFileName($output))`n"
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'Online-Setup-SHA256.txt'), $checksum, [Text.Encoding]::ASCII)
Write-Output "Built: $output"
Write-Output $checksum.Trim()
