param([Parameter(Mandatory = $true)][string]$OutDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# A LARGE JPEG fixture, painted the same way as the small ones so the checks can
# exercise both resize limits on a real lossy JPEG. 1600x1200 is deliberately
# above the thumbnail limit (480) and exactly on the web limit (1600), so the web
# derivative must be scaled to the limit and the thumbnail must be far smaller.
$path = Join-Path $OutDirectory 'large.jpg'
$bitmap = New-Object System.Drawing.Bitmap(1600, 1200, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$bandHeight = [Math]::Floor(1200 / 6)
$colours = @(
  [System.Drawing.Color]::FromArgb(255, 214, 48, 62),
  [System.Drawing.Color]::FromArgb(255, 32, 120, 210),
  [System.Drawing.Color]::FromArgb(255, 246, 198, 44),
  [System.Drawing.Color]::FromArgb(255, 36, 168, 96),
  [System.Drawing.Color]::FromArgb(255, 12, 14, 18),
  [System.Drawing.Color]::FromArgb(255, 200, 200, 200)
)
for ($index = 0; $index -lt 6; $index++) {
  $brush = New-Object System.Drawing.SolidBrush($colours[$index])
  $graphics.FillRectangle($brush, 0, ($index * $bandHeight), 1600, $bandHeight)
  $brush.Dispose()
}
$graphics.Dispose()

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
$parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [int64]88)
$bitmap.Save($path, $codec, $parameters)
$parameters.Dispose()
$bitmap.Dispose()
Write-Host ("large jpeg fixture: {0} bytes, exists {1}" -f (Get-Item $path).Length, (Test-Path $path))
