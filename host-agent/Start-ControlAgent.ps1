# TwinView local control agent
# Receives mouse/keyboard events from the TwinView host tab (ws://127.0.0.1:8765)
# and injects them into Windows. Run while you are hosting a room.

$ErrorActionPreference = "Stop"
$Port = 8765
$Prefix = "http://127.0.0.1:$Port/"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TwinInput {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern short VkKeyScan(char ch);

  public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
  public const uint MOUSEEVENTF_WHEEL      = 0x0800;
  public const uint KEYEVENTF_KEYUP        = 0x0002;
}
"@

function Get-ScreenSize {
  Add-Type -AssemblyName System.Windows.Forms
  $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  return @{ Width = $s.Width; Height = $s.Height }
}

function Move-CursorNorm([double]$x, [double]$y, $screen) {
  $px = [int][Math]::Round([Math]::Max(0, [Math]::Min(1, $x)) * ($screen.Width - 1))
  $py = [int][Math]::Round([Math]::Max(0, [Math]::Min(1, $y)) * ($screen.Height - 1))
  [void][TwinInput]::SetCursorPos($px, $py)
}

function Invoke-Mouse($msg, $screen) {
  if ($null -ne $msg.x -and $null -ne $msg.y) {
    Move-CursorNorm ([double]$msg.x) ([double]$msg.y) $screen
  }

  $button = 0
  if ($null -ne $msg.button) { $button = [int]$msg.button }
  $action = [string]$msg.action

  switch ($action) {
    "move" { }
    "down" {
      if ($button -eq 2) { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero) }
      elseif ($button -eq 1) { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, [UIntPtr]::Zero) }
      else { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero) }
    }
    "up" {
      if ($button -eq 2) { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero) }
      elseif ($button -eq 1) { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_MIDDLEUP, 0, 0, 0, [UIntPtr]::Zero) }
      else { [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero) }
    }
  }
}

function Invoke-Wheel($msg, $screen) {
  if ($null -ne $msg.x -and $null -ne $msg.y) {
    Move-CursorNorm ([double]$msg.x) ([double]$msg.y) $screen
  }
  $delta = 0
  if ($null -ne $msg.deltaY) { $delta = [int](-1 * [double]$msg.deltaY) }
  if ($delta -eq 0) { return }
  # Windows wheel delta is typically multiples of 120
  $steps = [Math]::Max(-1200, [Math]::Min(1200, $delta))
  [TwinInput]::mouse_event([TwinInput]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]$steps, [UIntPtr]::Zero)
}

function Get-VirtualKey($msg) {
  $code = [string]$msg.code
  $key = [string]$msg.key

  $map = @{
    "Backspace" = 0x08; "Tab" = 0x09; "Enter" = 0x0D; "Escape" = 0x1B; "Space" = 0x20
    "PageUp" = 0x21; "PageDown" = 0x22; "End" = 0x23; "Home" = 0x24
    "ArrowLeft" = 0x25; "ArrowUp" = 0x26; "ArrowRight" = 0x27; "ArrowDown" = 0x28
    "Delete" = 0x2E; "Insert" = 0x2D
    "ControlLeft" = 0xA2; "ControlRight" = 0xA3
    "ShiftLeft" = 0xA0; "ShiftRight" = 0xA1
    "AltLeft" = 0xA4; "AltRight" = 0xA5
    "MetaLeft" = 0x5B; "MetaRight" = 0x5C
  }

  if ($map.ContainsKey($key)) { return [byte]$map[$key] }

  if ($code -match '^Key([A-Z])$') {
    return [byte][char]$Matches[1]
  }
  if ($code -match '^Digit([0-9])$') {
    return [byte]([int][char]$Matches[1])
  }
  if ($code -match '^Numpad([0-9])$') {
    return [byte](0x60 + [int]$Matches[1])
  }
  if ($code -match '^F([0-9]{1,2})$') {
    $n = [int]$Matches[1]
    if ($n -ge 1 -and $n -le 24) { return [byte](0x6F + $n) }
  }

  if ($key.Length -eq 1) {
    $scan = [TwinInput]::VkKeyScan([char]$key)
    if ($scan -ne -1) { return [byte]($scan -band 0xFF) }
  }

  return $null
}

function Invoke-Key($msg) {
  $vk = Get-VirtualKey $msg
  if ($null -eq $vk) { return }
  $action = [string]$msg.action
  if ($action -eq "down") {
    [TwinInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
  } elseif ($action -eq "up") {
    [TwinInput]::keybd_event($vk, 0, [TwinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  }
}

function Handle-Message([string]$json, $screen) {
  try {
    $msg = $json | ConvertFrom-Json
  } catch {
    return $null
  }

  switch ([string]$msg.type) {
    "hello" {
      return (@{ type = "ready"; screenWidth = $screen.Width; screenHeight = $screen.Height } | ConvertTo-Json -Compress)
    }
    "mouse" { Invoke-Mouse $msg $screen }
    "wheel" { Invoke-Wheel $msg $screen }
    "key"   { Invoke-Key $msg }
  }
  return $null
}

# --- HTTP + WebSocket listener ---
$screen = Get-ScreenSize
Write-Host ""
Write-Host "  TwinView control agent" -ForegroundColor Yellow
Write-Host "  Listening on $Prefix" -ForegroundColor Green
Write-Host "  Screen: $($screen.Width) x $($screen.Height)"
Write-Host "  Keep this window open while hosting. Press Ctrl+C to stop."
Write-Host ""

# UrlAcl may be needed on some machines; try listen, guide user if denied
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($Prefix)

try {
  $listener.Start()
} catch {
  Write-Host "Could not bind $Prefix" -ForegroundColor Red
  Write-Host "Try once (Admin PowerShell):" -ForegroundColor Yellow
  Write-Host "  netsh http add urlacl url=$Prefix user=$env:USERNAME"
  Write-Host ""
  Write-Host $_.Exception.Message
  exit 1
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    if (-not $context.Request.IsWebSocketRequest) {
      $context.Response.StatusCode = 400
      $bytes = [Text.Encoding]::UTF8.GetBytes("TwinView agent: WebSocket only")
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
      continue
    }

    Write-Host ("[{0}] Browser connected" -f (Get-Date -Format "HH:mm:ss")) -ForegroundColor Cyan
    $wsContext = $context.AcceptWebSocketAsync($null).GetAwaiter().GetResult()
    $socket = $wsContext.WebSocket
    $buffer = New-Object byte[] 8192

    # Greet
    $hello = (@{ type = "ready"; screenWidth = $screen.Width; screenHeight = $screen.Height } | ConvertTo-Json -Compress)
    $helloBytes = [Text.Encoding]::UTF8.GetBytes($hello)
    $helloSeg = [ArraySegment[byte]]::new($helloBytes)
    $socket.SendAsync($helloSeg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

    while ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $segment = [ArraySegment[byte]]::new($buffer)
      $result = $socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()

      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "bye", [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
        break
      }

      $json = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
      # accumulate if fragmented
      while (-not $result.EndOfMessage) {
        $result = $socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $json += [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
      }

      $reply = Handle-Message $json $screen
      if ($reply) {
        $replyBytes = [Text.Encoding]::UTF8.GetBytes($reply)
        $replySeg = [ArraySegment[byte]]::new($replyBytes)
        $socket.SendAsync($replySeg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
      }
    }

    Write-Host ("[{0}] Browser disconnected" -f (Get-Date -Format "HH:mm:ss")) -ForegroundColor DarkGray
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
