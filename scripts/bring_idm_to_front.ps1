# Bring IDM window to front.
# Uses Windows COM to find and activate the Internet Download Manager window.

$idmProcess = Get-WmiObject -Class Win32_Process -Filter "Name = 'idman.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $idmProcess) {
    exit 0
}

$shell = New-Object -ComObject WScript.Shell
foreach ($title in @("Internet Download Manager", "IDM", "idman")) {
    try {
        if ($shell.AppActivate($title)) {
            break
        }
    } catch {
        # Try the next title if IDM uses a different window caption.
    }
}

exit 0
