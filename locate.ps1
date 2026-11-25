# One-shot: asks Windows for this PC's position (the Windows location service, the same source as the Maps app) and prints "lat lon", or FAIL.
# Runs only when you press "Use my location" on the Weather page. Nothing is stored by this script.
try {
  Add-Type -AssemblyName System.Device
  $w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)
  if (-not $w.TryStart($false, [TimeSpan]::FromSeconds(8))) { 'FAIL'; exit 0 }
  $loc = $w.Position.Location
  if ($loc.IsUnknown) { 'FAIL'; exit 0 }
  [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:F4} {1:F4}', $loc.Latitude, $loc.Longitude)
} catch { 'FAIL' }
