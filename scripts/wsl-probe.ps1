# Throwaway: print what `wsl.exe --status` and `wsl.exe --list --quiet` emit
# (exit code, raw bytes, decoded text), with and without WSL_UTF8=1.
$ErrorActionPreference = 'Continue'

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
"wsl.exe on PATH: $($wsl.Source)"

foreach ($utf8 in @($false, $true)) {
    if ($utf8) { $env:WSL_UTF8 = '1' } else { Remove-Item Env:WSL_UTF8 -ErrorAction SilentlyContinue }
    foreach ($wslArgs in @('--status', '--list --quiet')) {
        "`n===== wsl.exe $wslArgs  (WSL_UTF8=$([int]$utf8)) ====="
        $out = Join-Path $env:RUNNER_TEMP 'wsl-out.bin'
        # cmd redirection keeps the bytes untouched by PowerShell's decoding
        cmd /c "wsl.exe $wslArgs > `"$out`" 2>&1"
        "exit code: $LASTEXITCODE"
        $bytes = [IO.File]::ReadAllBytes($out)
        "byte count: $($bytes.Length)"
        '--- first 64 bytes (hex) ---'
        if ($bytes.Length) { Format-Hex -InputObject $bytes[0..([Math]::Min(63, $bytes.Length - 1))] | Out-String }
        '--- decoded as UTF-16LE ---'
        [Text.Encoding]::Unicode.GetString($bytes)
        '--- decoded as UTF-8 ---'
        [Text.Encoding]::UTF8.GetString($bytes)
    }
}
exit 0
