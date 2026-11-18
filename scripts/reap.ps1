<#
  取り残されたプロセスを止める（Windows）。worktree を消せなくなる原因を取り除く。

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reap.ps1                      # 取り残されたヘッドレスブラウザだけ
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reap.ps1 -Worktree <パス>     # その worktree の開発サーバなども

  止めるもの
  - ヘッドレスの Edge と Chrome のうち、プロファイルが一時フォルダ（TEMP）の中にあり、使い手が終わっているもの
    - scripts/headless.ts のプロファイルは名前に起動したスクリプトの PID（-o<PID>-）を持つので、その PID が終わっていれば止める
    - ほかのプロファイルは、起動から -MinAgeMinutes 分（既定 60）を過ぎていれば止める
    - Edge は起動役のプロセスがすぐ終わり、本体の親はいつも終わっているので、親では見分けられない
    - ふだん使うブラウザはヘッドレスでなく、プロファイルも TEMP の外にあるので当たらない
  - -Worktree を渡したときは、コマンドラインにその worktree のパスを含む node・bun・deno（astro dev・vite・vitest など）。
    プロセスツリーごと止める。自分と自分の親は除く
  あわせて、どのプロセスも使っていない TEMP の nanase-tools-* のフォルダを消す（-MinAgeMinutes を過ぎたもの）。
  -DryRun を付けると、止めずに一覧だけ出す
#>
param([string]$Worktree = '', [int]$MinAgeMinutes = 60, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
# 進捗の表示は、出力を受け取る側に CLIXML として混ざるので出さない
$ProgressPreference = 'SilentlyContinue'
# 呼び出し元（bun・Orca のフック）が UTF-8 で読めるように出す
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$procs = Get-CimInstance Win32_Process
$alive = @{}
foreach ($p in $procs) { $alive[[int]$p.ProcessId] = $p }

# 自分と親（このスクリプトを呼んだシェルや bun）は止めない
$keep = @{}
$id = $PID
while ($id -and $alive.ContainsKey($id) -and -not $keep.ContainsKey($id)) {
  $keep[$id] = $true
  $id = [int]$alive[$id].ParentProcessId
}

$tmp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$old = (Get-Date).AddMinutes(-$MinAgeMinutes)
$targets = New-Object System.Collections.Generic.List[object]
$inUse = @{}

foreach ($p in $procs) {
  if ($p.Name -notin 'msedge.exe', 'chrome.exe') { continue }
  $cl = [string]$p.CommandLine
  if ($cl -notmatch '--headless' -or $cl -notmatch '--user-data-dir=(?:"([^"]+)"|(\S+))') { continue }
  $dir = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  try { $full = [IO.Path]::GetFullPath($dir.Replace('/', '\')).TrimEnd('\') } catch { continue }
  if (-not $full.StartsWith($tmp, [StringComparison]::OrdinalIgnoreCase)) { continue }
  $inUse[$full.ToLowerInvariant()] = $true
  if ($cl -match '--type=') { continue }
  $leaf = Split-Path $full -Leaf
  $stale = if ($leaf -match '^nanase-tools-.+-o(\d+)-') { -not $alive.ContainsKey([int]$Matches[1]) } else { $p.CreationDate -lt $old }
  if ($stale) { $targets.Add([pscustomobject]@{ Id = [int]$p.ProcessId; Kind = 'ヘッドレスブラウザ'; Dir = $full }) }
}

if ($Worktree) {
  $wt = [IO.Path]::GetFullPath($Worktree).TrimEnd('\')
  $pats = @($wt, $wt.Replace('\', '/')) | ForEach-Object { [regex]::Escape($_) + '([\\/"\s]|$)' }
  foreach ($p in $procs) {
    if ($p.Name -notin 'node.exe', 'bun.exe', 'deno.exe') { continue }
    if ($keep.ContainsKey([int]$p.ProcessId)) { continue }
    $cl = [string]$p.CommandLine
    if (-not ($pats | Where-Object { $cl -match $_ })) { continue }
    $targets.Add([pscustomobject]@{ Id = [int]$p.ProcessId; Kind = $p.Name; Dir = '' })
  }
}

foreach ($t in $targets) {
  if ($DryRun) { "止める対象: $($t.Kind) $($t.Id)"; continue }
  & taskkill.exe /PID $t.Id /T /F 2>$null | Out-Null
  "止めた: $($t.Kind) $($t.Id)"
  if ($t.Dir) { $inUse.Remove($t.Dir.ToLowerInvariant()) }
}

# 使われていない古いプロファイル（scripts/headless.ts と以前のスクリプトが作ったもの）
if ($targets.Count -and -not $DryRun) { Start-Sleep -Milliseconds 500 }
$swept = 0
Get-ChildItem -LiteralPath $tmp -Directory -Filter 'nanase-tools-*' -ErrorAction SilentlyContinue | ForEach-Object {
  if ($inUse.ContainsKey($_.FullName.TrimEnd('\').ToLowerInvariant())) { return }
  $owned = $_.Name -match '^nanase-tools-.+-o(\d+)-'
  if ($owned -and $alive.ContainsKey([int]$Matches[1])) { return }
  if (-not $owned -and $_.LastWriteTime -ge $old) { return }
  if ($DryRun) { "消す対象: $($_.Name)"; return }
  Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $_.FullName)) { $swept++ }
}
if ($swept) { "消したプロファイル: $swept 個" }
if (-not $targets.Count -and -not $swept) { '止めるプロセスはありません' }
exit 0
