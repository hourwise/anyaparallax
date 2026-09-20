param([Parameter(Mandatory = $true)][string]$OutDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# A PORTRAIT fixture whose height is well above the web limit. The web derivative
# must bring the LONGEST edge to 1600, which for this source means scaling by
# height and letting the width follow — the case that would expose a resize that
# clipped one edge instead of scaling the whole image.
$path = Join-Path $OutDirectory 'portrait.jpg'
$bitmap = New-Object System.Drawing.Bitmap(1200, 2400, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$bandHeight = [Math]::Floor(2400 / 6)
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
  $graphics.FillRectangle($brush, 0, ($index * $bandHeight), 1200, $bandHeight)
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
Write-Host ("portrait fixture: {0} bytes, exists {1}" -f (Get-Item $path).Length, (Test-Path $path))
