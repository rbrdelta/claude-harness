# obsidian-restart.ps1 - nightly Obsidian restart to force a full Sync reconciliation.
#
# Why: Obsidian Sync's live upload can silently skip a file (seen 2026-09-03: target_list.md and
# NorthStar.md sat local-only for two weeks while Obsidian ran online). Only a reconnect or a
# restart makes Sync compare local vs remote and upload what it skipped. Details: vault
# Meta/Learnings.md, entry 2026-09-18.
#
# Installed by install-obsidian-restart.ps1 as Task Scheduler task "Obsidian nightly restart"
# (daily 04:00, catch-up run if the machine was asleep). Runs in the interactive session so the
# relaunched window lands in Daniel's desktop. Obsidian saves continuously, so a close loses nothing.
#
# Log: %LOCALAPPDATA%\claude-harness\obsidian-restart.log
#      read by ~/.claude/hooks/harness-check.sh (SessionStart) and /harness.
#      Lines: "<ts> OK: ..." on success, "<ts> FAIL: ..." on failure.

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:LOCALAPPDATA 'claude-harness'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'obsidian-restart.log'
function Log([string]$msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $log }

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Obsidian\Obsidian.exe'
if (-not (Test-Path $exe)) { Log "FAIL: Obsidian.exe not found at $exe"; exit 1 }

# A catch-up run right after a wake adds nothing: the wake already reconnected Sync, which
# reconciles the same way a restart does. Skip it rather than restart Obsidian under Daniel.
$recentWake = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Power-Troubleshooter'; Id=1; StartTime=(Get-Date).AddMinutes(-15)} -ErrorAction SilentlyContinue
if ($recentWake) { Log "OK: skipped restart (catch-up run within 15 min of wake; the wake already reconciled Sync)"; exit 0 }

$procs = Get-Process Obsidian -ErrorAction SilentlyContinue
if ($procs) {
    $started = ($procs | Sort-Object StartTime | Select-Object -First 1).StartTime
    Log "closing Obsidian (running since $started, pids $($procs.Id -join ','))"
    $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Process Obsidian -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Seconds 1 }
    if (Get-Process Obsidian -ErrorAction SilentlyContinue) {
        Log "graceful close timed out after 20s; forcing"
        Get-Process Obsidian -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 3
    }
} else {
    Log "Obsidian was not running"
}

Start-Process -FilePath $exe
Start-Sleep -Seconds 15
$after = Get-Process Obsidian -ErrorAction SilentlyContinue
if ($after) { Log "OK: relaunched (pid $($after[0].Id))"; exit 0 }
Log "FAIL: no Obsidian process 15s after relaunch"
exit 1
