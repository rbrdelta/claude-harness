# install-obsidian-restart.ps1 - installs the "Obsidian nightly restart" Task Scheduler task.
# Copies obsidian-restart.ps1 to %LOCALAPPDATA%\claude-harness (the task must not depend on WSL
# being up at 04:00) and registers the task for the current user. Idempotent: re-run to update.
#
# From WSL:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w ~/projects/active/claude-harness/windows/install-obsidian-restart.ps1)"
# Verify:
#   schtasks.exe /Query /TN "Obsidian nightly restart" /FO LIST /V
#   powershell.exe -NoProfile -Command "Start-ScheduledTask -TaskName 'Obsidian nightly restart'"   # run it now

$ErrorActionPreference = 'Stop'
$taskName = 'Obsidian nightly restart'
$dest = Join-Path $env:LOCALAPPDATA 'claude-harness'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'obsidian-restart.ps1') -Destination $dest -Force
$script = Join-Path $dest 'obsidian-restart.ps1'

$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger   = New-ScheduledTaskTrigger -Daily -At 4:00AM
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Description 'Restarts Obsidian so Sync does a full local/remote reconciliation. Source: ~/projects/active/claude-harness/windows/' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$t = Get-ScheduledTask -TaskName $taskName
$i = Get-ScheduledTaskInfo -TaskName $taskName
"registered: '$($t.TaskName)' state=$($t.State) next=$($i.NextRunTime) script=$script"
