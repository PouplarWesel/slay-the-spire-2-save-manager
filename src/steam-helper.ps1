$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$initialized = $false
$needsRecovery = $false
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -notin @('read', 'apply', 'status', 'names')) { throw 'Unsupported Steam operation.' }
  if ($request.profileKey -notmatch '^(modded/)?profile[0-9]+/saves$') { throw 'Invalid multiplayer profile key.' }
  if ($request.steamId -notmatch '^7656119[0-9]{10}$') { throw 'Invalid Steam account ID.' }
  $dllPath = [IO.Path]::GetFullPath($request.dllPath)
  if ([IO.Path]::GetFileName($dllPath) -ne 'steam_api64.dll' -or -not [IO.File]::Exists($dllPath)) { throw 'The game’s Steam library was not found.' }
  $env:SteamAppId = '2868840'
  $env:SteamGameId = '2868840'
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SpireSteam {
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibrary(string path);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern int SteamAPI_InitFlat(System.Text.StringBuilder error);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern void SteamAPI_Shutdown();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_SteamRemoteStorage_v016();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_SteamUser_v023();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_SteamUtils_v010();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_SteamFriends_v017();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern void SteamAPI_RunCallbacks();
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_ISteamFriends_GetPersonaName(IntPtr friends);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SteamAPI_ISteamFriends_GetFriendPersonaName(IntPtr friends, UInt64 user);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamFriends_RequestUserInformation(IntPtr friends, UInt64 user, [MarshalAs(UnmanagedType.I1)] bool nameOnly);
  public static string Utf8(IntPtr p) { if(p==IntPtr.Zero)return ""; int n=0; while(n<4096 && Marshal.ReadByte(p,n)!=0)n++; byte[] b=new byte[n]; Marshal.Copy(p,b,0,n); return System.Text.Encoding.UTF8.GetString(b); }
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern UInt64 SteamAPI_ISteamUser_GetSteamID(IntPtr user);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern UInt32 SteamAPI_ISteamUtils_GetAppID(IntPtr utils);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp(IntPtr store);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount(IntPtr store);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_FileExists(IntPtr store, [MarshalAs(UnmanagedType.LPStr)] string name);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern int SteamAPI_ISteamRemoteStorage_GetFileSize(IntPtr store, [MarshalAs(UnmanagedType.LPStr)] string name);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] public static extern int SteamAPI_ISteamRemoteStorage_FileRead(IntPtr store, [MarshalAs(UnmanagedType.LPStr)] string name, [Out] byte[] data, int size);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_FileWrite(IntPtr store, [MarshalAs(UnmanagedType.LPStr)] string name, byte[] data, int size);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_FileDelete(IntPtr store, [MarshalAs(UnmanagedType.LPStr)] string name);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_BeginFileWriteBatch(IntPtr store);
  [DllImport("steam_api64", CallingConvention=CallingConvention.Cdecl)] [return:MarshalAs(UnmanagedType.I1)] public static extern bool SteamAPI_ISteamRemoteStorage_EndFileWriteBatch(IntPtr store);
}
'@
  if ([SpireSteam]::LoadLibrary($dllPath) -eq [IntPtr]::Zero) { throw 'Could not load the game’s Steam library.' }
  $initError = New-Object Text.StringBuilder 1024
  if ([SpireSteam]::SteamAPI_InitFlat($initError) -ne 0) { throw ('Steam is not available. Start Steam and sign into the save’s account before swapping. ' + $initError.ToString()) }
  $initialized = $true
  $user = [SpireSteam]::SteamAPI_SteamUser_v023()
  $utils = [SpireSteam]::SteamAPI_SteamUtils_v010()
  $remote = [SpireSteam]::SteamAPI_SteamRemoteStorage_v016()
  if ($user -eq [IntPtr]::Zero -or $utils -eq [IntPtr]::Zero -or $remote -eq [IntPtr]::Zero) { throw 'Steam storage interfaces are unavailable.' }
  if ([SpireSteam]::SteamAPI_ISteamUtils_GetAppID($utils) -ne 2868840) { throw 'Steam connected to the wrong game. No saves were changed.' }
  $actualId = [SpireSteam]::SteamAPI_ISteamUser_GetSteamID($user).ToString()
  if ($actualId -ne $request.steamId) { throw 'Steam is signed into a different account from this game profile. No saves were changed.' }
  if ($request.action -eq 'names') {
    $ids = @($request.ids | Select-Object -Unique)
    if ($ids.Count -gt 64) { throw 'Too many player IDs.' }
    $friends = [SpireSteam]::SteamAPI_SteamFriends_v017()
    if ($friends -eq [IntPtr]::Zero) { throw 'Steam Friends is unavailable.' }
    foreach ($id in $ids) {
      if ($id -isnot [string] -or $id -notmatch '^7656119[0-9]{10}$') { throw 'Invalid Steam player ID.' }
      if ($id -ne $actualId) { [SpireSteam]::SteamAPI_ISteamFriends_RequestUserInformation($friends,[UInt64]::Parse($id),$true) | Out-Null }
    }
    $resolved = @{}
    for ($attempt=0; $attempt -lt 25; $attempt++) {
      [SpireSteam]::SteamAPI_RunCallbacks()
      foreach ($id in $ids) {
        $ptr = if ($id -eq $actualId) { [SpireSteam]::SteamAPI_ISteamFriends_GetPersonaName($friends) } else { [SpireSteam]::SteamAPI_ISteamFriends_GetFriendPersonaName($friends,[UInt64]::Parse($id)) }
        $name = [SpireSteam]::Utf8($ptr)
        if ($name -and $name -ne '[unknown]') { $resolved[$id] = $name }
      }
      if ($resolved.Count -eq $ids.Count) { break }
      Start-Sleep -Milliseconds 100
    }
    [Console]::Out.WriteLine('SPIREKEEPER_RESULT=' + (@{ok=$true;steamId=$actualId;names=$resolved} | ConvertTo-Json -Compress -Depth 6))
    return
  }
  $enabled = [SpireSteam]::SteamAPI_ISteamRemoteStorage_IsCloudEnabledForApp($remote) -and [SpireSteam]::SteamAPI_ISteamRemoteStorage_IsCloudEnabledForAccount($remote)
  $names = @('current_run_mp.save', 'current_run_mp.save.backup')
  function Read-Pair {
    $files = @{}
    foreach ($name in $names) {
      $key = $request.profileKey + '/' + $name
      if ([SpireSteam]::SteamAPI_ISteamRemoteStorage_FileExists($remote, $key)) {
        $size = [SpireSteam]::SteamAPI_ISteamRemoteStorage_GetFileSize($remote, $key)
        if ($size -lt 0 -or $size -gt 33554432) { throw 'Steam multiplayer save exceeds the supported size limit.' }
        $bytes = New-Object byte[] $size
        $read = [SpireSteam]::SteamAPI_ISteamRemoteStorage_FileRead($remote, $key, $bytes, $size)
        if ($read -ne $size) { throw 'Steam did not return the complete multiplayer save.' }
        $files[$name] = [Convert]::ToBase64String($bytes)
      }
    }
    return $files
  }
  function Write-Pair($files) {
    foreach ($name in $names) {
      $key = $request.profileKey + '/' + $name
      if ($files.ContainsKey($name)) {
        $bytes = [Convert]::FromBase64String($files[$name])
        if ($bytes.Length -gt 33554432) { throw 'Steam multiplayer save exceeds the supported size limit.' }
        if (-not [SpireSteam]::SteamAPI_ISteamRemoteStorage_FileWrite($remote, $key, $bytes, $bytes.Length)) { throw "Steam rejected writing $name." }
      } elseif ([SpireSteam]::SteamAPI_ISteamRemoteStorage_FileExists($remote, $key)) {
        if (-not [SpireSteam]::SteamAPI_ISteamRemoteStorage_FileDelete($remote, $key)) { throw "Steam rejected removing $name." }
      }
    }
  }
  $before = Read-Pair
  if ($request.action -eq 'apply') {
    if (Get-Process -Name sts2,SlayTheSpire2 -ErrorAction SilentlyContinue) { throw 'Close Slay the Spire 2 before changing Steam saves.' }
    if (-not $enabled) { throw 'Steam Cloud settings changed during the swap. Refresh and try again.' }
    $expected = @{}
    foreach ($prop in $request.expected.PSObject.Properties) {
      if ($prop.Name -notin $names -or $prop.Value -isnot [string]) { throw 'Invalid expected Steam save.' }
      $expected[$prop.Name] = $prop.Value
    }
    foreach ($name in $names) {
      if ($before[$name] -cne $expected[$name]) { throw 'Steam save changed during the swap. Refresh and try again. No files were changed.' }
    }
    $desired = @{}
    foreach ($prop in $request.files.PSObject.Properties) {
      if ($prop.Name -notin $names -or $prop.Value -isnot [string]) { throw 'Invalid multiplayer payload.' }
      $bytes = [Convert]::FromBase64String($prop.Value)
      if ($bytes.Length -gt 33554432) { throw 'Multiplayer payload exceeds size limit.' }
      $desired[$prop.Name] = $prop.Value
    }
    if (-not [SpireSteam]::SteamAPI_ISteamRemoteStorage_BeginFileWriteBatch($remote)) { throw 'Steam is already writing saves. Wait and try again.' }
    try {
      $needsRecovery = $true
      try {
        Write-Pair $desired
        $after = Read-Pair
        foreach ($name in $names) { if ($after[$name] -cne $desired[$name]) { throw 'Steam save verification failed.' } }
        $needsRecovery = $false
      } catch {
        $failure = $_.Exception.Message
        try { Write-Pair $before } catch { throw "Steam swap failed and rollback needs recovery: $failure" }
        $needsRecovery = $false
        throw $failure
      }
    } finally { [SpireSteam]::SteamAPI_ISteamRemoteStorage_EndFileWriteBatch($remote) | Out-Null }
  }
  $result = @{ ok = $true; enabled = [bool]$enabled; steamId = $actualId; files = $(if ($request.action -eq 'status') { @{} } elseif ($request.action -eq 'apply') { $desired } else { $before }) }
} catch { $result = @{ ok = $false; error = $_.Exception.Message; needsRecovery = $needsRecovery } }
finally { if ($initialized) { [SpireSteam]::SteamAPI_Shutdown() } }
[Console]::Out.WriteLine('SPIREKEEPER_RESULT=' + ($result | ConvertTo-Json -Compress -Depth 8))
