# Screenshot capture script for debugging
# Run this, then use the app - it captures a screenshot every second

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$outputDir = "$PSScriptRoot\captures"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

# Clear old captures
Remove-Item "$outputDir\*.png" -ErrorAction SilentlyContinue

Write-Host "Starting screen capture to $outputDir"
Write-Host "Press Ctrl+C to stop"

$counter = 0
while ($true) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)

    $filename = "$outputDir\capture_$('{0:D4}' -f $counter).png"
    $bitmap.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $bitmap.Dispose()

    $counter++
    Write-Host "Captured frame $counter"

    Start-Sleep -Milliseconds 1000
}
