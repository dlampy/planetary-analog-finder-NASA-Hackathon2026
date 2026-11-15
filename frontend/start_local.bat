@echo off
title NASA 3D Local Server (http://localhost:8080)
echo Dang khoi dong may chu web cuc bo cho DLT_NASAHackathon2026...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = '%~dp0'.TrimEnd('\'); $sep = '#__PS_' + 'START__'; $code = ((Get-Content -Raw -LiteralPath '%~f0') -split $sep, 2)[1]; Invoke-Expression $code"
pause
exit /b

#__PS_START__
Add-Type -AssemblyName System.Web
$listener = $null
$port = 8080
for ($p = 8080; $p -le 8090; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch {
    if ($l) { $l.Close() }
  }
}

if (-not $listener) {
  Write-Host "Khong the mo cong 8080-8090." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$port/index.html"
Write-Host "Server dang chay tai: $url" -ForegroundColor Green
Write-Host "Nhan Ctrl+C hoac dong cua so nay de tat server." -ForegroundColor Yellow
Start-Process $url

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".csv"  = "text/csv; charset=utf-8"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
  ".txt"  = "text/plain; charset=utf-8"
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $root ".."))
$backendDataRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "backend\data"))

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $reqPath = $ctx.Request.Url.LocalPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = "index.html" }
    $relPath = $reqPath.Replace('/', '\')

    if ($relPath.StartsWith("backend\data\", [System.StringComparison]::OrdinalIgnoreCase)) {
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $relPath))
      $allowed = $fullPath.StartsWith($backendDataRoot, [System.StringComparison]::OrdinalIgnoreCase)
    } else {
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $relPath))
      $allowed = $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
    }

    if (-not $allowed -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
      continue
    }

    $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
    $ctx.Response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
    if ($ext -in @(".html", ".htm", ".json", ".csv")) {
      $ctx.Response.AddHeader("Cache-Control", "no-store, no-cache, must-revalidate")
    }
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
