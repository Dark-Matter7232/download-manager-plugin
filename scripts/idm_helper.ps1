# IDM API helper - PowerShell wrapper for Internet Download Manager.
# Arguments: URL, Referrer, Cookie, PostData, Username, Password, OutputPath,
# OutputFilename, UserAgent, Flags

param(
    [Parameter(Position = 0)] [string] $Url,
    [Parameter(Position = 1)] [string] $Referrer = "",
    [Parameter(Position = 2)] [string] $Cookie = "",
    [Parameter(Position = 3)] [string] $PostData = "",
    [Parameter(Position = 4)] [string] $Username = "",
    [Parameter(Position = 5)] [string] $Password = "",
    [Parameter(Position = 6)] [string] $OutputPath = "",
    [Parameter(Position = 7)] [string] $OutputFilename = "",
    [Parameter(Position = 8)] [string] $UserAgent = "",
    [Parameter(Position = 9)] [int] $Flags = 1
)

function Write-Result {
    param(
        [bool] $Success,
        [string] $Message,
        [int] $ExitCode
    )

    if ($Success) {
        @{ success = $true; message = $Message } | ConvertTo-Json -Compress
    } else {
        @{ error = $Message; success = $false } | ConvertTo-Json -Compress
    }
    exit $ExitCode
}

if ([string]::IsNullOrEmpty($Url)) {
    Write-Result -Success $false -Message "URL is required" -ExitCode 1
}

function Get-RegistryDefaultValue {
    param([string] $SubKey)

    $key = $null
    try {
        $key = [Microsoft.Win32.Registry]::ClassesRoot.OpenSubKey($SubKey)
        if ($null -eq $key) {
            return ""
        }
        return [string] $key.GetValue("")
    } catch {
        return ""
    } finally {
        if ($null -ne $key) {
            $key.Dispose()
        }
    }
}

$idmPath = ""
$clsid = Get-RegistryDefaultValue -SubKey "IDMan.CIDMLinkTransmitter\CLSID"
if ($clsid) {
    $serverPath = Get-RegistryDefaultValue -SubKey "CLSID\$clsid\LocalServer32"
    if ($serverPath) {
        # LocalServer32 can contain both a quoted executable and registration arguments.
        $quotedPath = [regex]::Match($serverPath, '^\s*"([^"]+)"').Groups[1].Value
        $idmPath = if ($quotedPath) { $quotedPath } else { ($serverPath -split '\s+', 2)[0] }
    }
}

if (-not $idmPath) {
    $idmPath = "C:\Program Files (x86)\Internet Download Manager\IDMan.exe"
    if (-not (Test-Path -LiteralPath $idmPath -PathType Leaf)) {
        $idmPath = "C:\Program Files\Internet Download Manager\IDMan.exe"
        if (-not (Test-Path -LiteralPath $idmPath -PathType Leaf)) {
            Write-Result -Success $false -Message "Internet Download Manager not found. Please install IDM first." -ExitCode 1
        }
    }
}

# IDM command line: IDMan.exe /d URL [/p localpath] [/f filename] /n
$command = '"{0}" /d "{1}"' -f $idmPath, $Url
if (-not [string]::IsNullOrEmpty($OutputFilename)) {
    $command += ' /f "{0}"' -f $OutputFilename
}
if (-not [string]::IsNullOrEmpty($OutputPath)) {
    $command += ' /p "{0}"' -f $OutputPath
}
$command += " /n"

try {
    $shell = New-Object -ComObject WScript.Shell
    # Keep the original hidden, non-blocking WScript.Shell.Run behavior.
    $shell.Run($command, 0, $false) | Out-Null
} catch {
    Write-Result -Success $false -Message $_.Exception.Message -ExitCode 1
}

Write-Result -Success $true -Message "Download sent to IDM successfully" -ExitCode 0
