# install-wsl-keepalive.ps1 - installs the "WSL keepalive" logon task, which starts WSL and keeps it up.
#
# Why: the old task ran `wsl -u root service cron start`, which returns at once. With no wsl.exe
# client attached, WSL stops the distro about 30 seconds later (vmIdleTimeout=-1 in .wslconfig
# keeps the VM, not the distro). On 2026-11-26 a Windows Update restart at 00:07 brought WSL up
# at logon for 35 seconds, then everything (cron, systemd timers, the remote-control daemon, the
# overnight PM run, the syncs) stayed down until a terminal was opened at 21:11.
#
# Fix: the task now holds a wsl.exe client open (`exec sleep infinity`), run through
# `conhost.exe --headless` so no console window shows, with no execution time limit (the old
# task's 72h limit would have killed the keepalive). systemd=true in /etc/wsl.conf starts cron
# and the timers once the distro is up; `service cron start` stays as a harmless backstop.
# The old admin-created "WSL2 Cron Start" task can't be overwritten without elevation (Access
# denied, 2026-11-26), so this is a separate user-level task; the old one is left in place (it only
# starts cron and exits, harmless alongside this). Idempotent: re-run to update.
#
# From WSL:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w ~/projects/active/claude-harness/windows/install-wsl-keepalive.ps1)"
# Verify:
#   powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName 'WSL keepalive' | Select -Expand Actions"
#   pgrep -af 'sleep infinity'    # inside WSL, after the task has run (at logon, or Start-ScheduledTask)

$ErrorActionPreference = 'Stop'
$taskName = 'WSL keepalive'

$action    = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless wsl.exe -u root --exec /bin/sh -c "service cron start; exec sleep infinity"'
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Description 'Starts WSL at logon and keeps it running so cron, systemd timers and the remote-control daemon survive Windows restarts. Source: ~/projects/active/claude-harness/windows/' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$t = Get-ScheduledTask -TaskName $taskName
"registered: '$($t.TaskName)' state=$($t.State) action=$($t.Actions[0].Execute) $($t.Actions[0].Arguments) limit=$($t.Settings.ExecutionTimeLimit)"
