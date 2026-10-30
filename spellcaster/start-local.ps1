$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8765/')

try {
  $listener.Start()
  Write-Host 'Spellcaster is available at http://localhost:8765/'
  Write-Host 'Press Ctrl+C to stop the local server.'

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = 'index.html'
      }

      $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))
      if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $context.Response.StatusCode = 403
      } elseif (-not [System.IO.File]::Exists($filePath)) {
        $context.Response.StatusCode = 404
      } else {
        $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
        $context.Response.ContentType = switch ($extension) {
          '.html' { 'text/html; charset=utf-8' }
          '.css' { 'text/css; charset=utf-8' }
          '.js' { 'text/javascript; charset=utf-8' }
          default { 'application/octet-stream' }
        }
        $context.Response.Headers['Cache-Control'] = 'no-store'
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}
