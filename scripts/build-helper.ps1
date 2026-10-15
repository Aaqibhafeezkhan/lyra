# Builds resources\lyra-media.exe with the C# compiler that ships with Windows plus the Windows 10/11 SDK
# metadata. The built exe is committed, so only helper developers need the SDK.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }

$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
function Find-Winmd($dir, $name) {
  $f = Get-ChildItem (Join-Path $kits $dir) -Recurse -Filter "$name.winmd" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'Facade' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $f) { throw "$name.winmd not found under $kits\$dir - install the Windows 10/11 SDK" }
  $f.FullName
}
$union = Find-Winmd 'UnionMetadata' 'Windows'
$universal = Find-Winmd 'References' 'Windows.Foundation.UniversalApiContract'
$foundation = Find-Winmd 'References' 'Windows.Foundation.FoundationContract'

$out = Join-Path $root 'resources\lyra-media.exe'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null

& $csc /nologo /target:exe /optimize+ /platform:x64 "/out:$out" `
  "/r:$union" "/r:$fw\System.Runtime.WindowsRuntime.dll" "/r:$fw\System.Runtime.dll" "/r:$fw\System.Runtime.InteropServices.WindowsRuntime.dll" `
  (Join-Path $root 'native\lyra-media\Program.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Write-Host "built $out"
