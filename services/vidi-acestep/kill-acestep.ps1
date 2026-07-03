# Stop only the ACE-Step API server python (leaves ComfyUI/other python alone).
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -like '*acestep*' } | ForEach-Object {
  Write-Output ("killing acestep PID " + $_.ProcessId)
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output "KILL_DONE"
