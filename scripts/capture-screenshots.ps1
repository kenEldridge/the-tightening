# Screenshot capture script for debugging
# Captures screenshots to visuals_for_claude/captures/
# Waits for app to start, then captures every 1 second

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot "visuals_for_claude\captures"

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# Clear old captures
Remove-Item "$outputDir\*.png" -ErrorAction SilentlyContinue

Write-Host "[Capture] Waiting 15 seconds for app to start..."
Start-Sleep -Seconds 15

Write-Host "[Capture] Saving screenshots to $outputDir"
Write-Host "[Capture] Taking screenshot every 1 second for 30 seconds..."

$counter = 0
$startTime = Get-Date
$maxCaptures = 30

while ($counter -lt $maxCaptures) {
    try {
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)

        $filename = "$outputDir\capture_$('{0:D4}' -f $counter).png"
        $bitmap.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png)

        $graphics.Dispose()
        $bitmap.Dispose()

        $counter++
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        Write-Host "[Capture] Frame $counter/$maxCaptures at ${elapsed}s"
    }
    catch {
        Write-Host "[Capture] Error: $_"
    }

    Start-Sleep -Seconds 1
}

Write-Host "[Capture] Done! Captured $counter frames to $outputDir"
