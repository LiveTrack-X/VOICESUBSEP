# PowerShell 5.1+. Local file verification/assembly only; never launches the installer.
[CmdletBinding()]
param([string]$Directory = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
$temporary = $null
$destinationStream = $null
$payloadHasher = $null

function Assert-SafeName($Value) {
    if ($Value -isnot [string] -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' -or
        $Value.EndsWith('.') -or ($Value.Split('.')[0] -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$')) {
        throw 'Manifest contains an unsafe filename. Only ordinary Windows basenames are allowed.'
    }
}

function Assert-FileRecord($Record) {
    if ($null -eq $Record) { throw 'Manifest is missing a file record.' }
    Assert-SafeName $Record.name
    if ($Record.size -isnot [int] -and $Record.size -isnot [long]) { throw 'Manifest file size must be an integer.' }
    if ($Record.size -le 0) { throw 'Manifest file size must be positive.' }
    if ($Record.sha256 -isnot [string] -or $Record.sha256 -notmatch '^[0-9a-fA-F]{64}$') {
        throw 'Manifest contains an invalid SHA256 hash.'
    }
}

function Get-RegularFile([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Expected a regular file without a symbolic link: $Path"
    }
    return $item
}

function Assert-MatchingFile([string]$Path, $Record) {
    $item = Get-RegularFile $Path
    if ($item.Length -ne $Record.size) { throw "File size does not match the manifest: $($Record.name)" }
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $digest = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        if ($stream.Length -ne $Record.size -or $digest -ine $Record.sha256) {
            throw "SHA256 does not match the manifest: $($Record.name)"
        }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        $hasher.Dispose()
    }
}

function Hash-Hex($Hash) {
    return [BitConverter]::ToString($Hash.Hash).Replace('-', '').ToLowerInvariant()
}

try {
    $folder = Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
    if (-not $folder.PSIsContainer -or ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Choose an ordinary local directory containing all release assets.'
    }
    $root = $folder.FullName
    $manifestPath = Join-Path $root 'installer-manifest.json'
    $manifestFile = Get-RegularFile $manifestPath
    if ($manifestFile.Length -gt 1048576) { throw 'Manifest is unexpectedly large.' }
    $manifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($manifest.schemaVersion -isnot [int] -or $manifest.schemaVersion -ne 1 -or
        $manifest.version -isnot [string] -or $manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$') {
        throw 'Unsupported installer manifest.'
    }
    Assert-FileRecord $manifest.installer
    Assert-FileRecord $manifest.payload
    if (-not $manifest.installer.name.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase) -or
        -not $manifest.payload.name.EndsWith('.nsis.7z', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Manifest must describe an EXE installer and its original .nsis.7z payload.'
    }
    if ($manifest.payload.parts -isnot [array] -or $manifest.payload.parts.Count -lt 1 -or $manifest.payload.parts.Count -gt 990) {
        throw 'Manifest must contain a bounded ordered array of payload parts.'
    }
    $seen = @{}
    [long]$expectedSize = 0
    for ($index = 0; $index -lt $manifest.payload.parts.Count; $index++) {
        $part = $manifest.payload.parts[$index]
        Assert-FileRecord $part
        $expectedName = '{0}.part{1:D3}' -f $manifest.payload.name, ($index + 1)
        if ($part.name -cne $expectedName -or $seen.ContainsKey($part.name) -or $part.size -ge 2147483648) {
            throw 'Payload parts must be unique, consecutive, below 2 GiB, and use the original payload basename.'
        }
        $seen[$part.name] = $true
        if ($expectedSize -gt [long]::MaxValue - $part.size) { throw 'Payload size is too large.' }
        $expectedSize += $part.size
    }
    if ($expectedSize -ne $manifest.payload.size) { throw 'Payload size does not equal the sum of its parts.' }
    Assert-MatchingFile (Join-Path $root $manifest.installer.name) $manifest.installer
    $destination = Join-Path $root $manifest.payload.name
    if (Test-Path -LiteralPath $destination) {
        Assert-MatchingFile $destination $manifest.payload
        Write-Host "Verified existing payload for VOICESUBSEP $($manifest.version): $destination"
        Write-Host 'No installer was started. Run the EXE yourself when ready.'
        return
    }
    $temporary = Join-Path $root ($manifest.payload.name + '.assembling-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $destinationStream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $payloadHasher = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 1048576
    [long]$total = 0
    foreach ($part in $manifest.payload.parts) {
        $partPath = Join-Path $root $part.name
        $partFile = Get-RegularFile $partPath
        if ($partFile.Length -ne $part.size) { throw "Part size does not match: $($part.name)" }
        $partHasher = [Security.Cryptography.SHA256]::Create()
        $sourceStream = $null
        try {
            $sourceStream = [IO.File]::Open($partPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            [long]$count = 0
            while (($read = $sourceStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $count += $read
                if ($count -gt $part.size) { throw "Part changed during assembly: $($part.name)" }
                $destinationStream.Write($buffer, 0, $read)
                [void]$partHasher.TransformBlock($buffer, 0, $read, $buffer, 0)
                [void]$payloadHasher.TransformBlock($buffer, 0, $read, $buffer, 0)
            }
            [void]$partHasher.TransformFinalBlock([byte[]]@(), 0, 0)
            if ($count -ne $part.size -or (Hash-Hex $partHasher) -ine $part.sha256) {
                throw "Part SHA256 or size does not match: $($part.name)"
            }
            $total += $count
            Write-Host "Verified $($part.name)"
        } finally {
            if ($null -ne $sourceStream) { $sourceStream.Dispose() }
            $partHasher.Dispose()
        }
    }
    [void]$payloadHasher.TransformFinalBlock([byte[]]@(), 0, 0)
    if ($total -ne $manifest.payload.size -or (Hash-Hex $payloadHasher) -ine $manifest.payload.sha256) {
        throw 'Assembled payload SHA256 or size does not match the manifest.'
    }
    $destinationStream.Flush()
    $destinationStream.Dispose()
    $destinationStream = $null
    # File.Move refuses to overwrite a destination created during assembly.
    [IO.File]::Move($temporary, $destination)
    $temporary = $null
    Write-Host "Assembled and verified VOICESUBSEP $($manifest.version): $destination"
    Write-Host 'No installer was started. Keep the payload beside the EXE and run the EXE yourself when ready.'
} catch {
    [Console]::Error.WriteLine('Installer assembly failed: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $destinationStream) { $destinationStream.Dispose() }
    if ($null -ne $payloadHasher) { $payloadHasher.Dispose() }
    if ($null -ne $temporary -and [IO.File]::Exists($temporary)) {
        Remove-Item -LiteralPath $temporary -Force
    }
}
