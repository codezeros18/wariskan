$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".\secrets.ps1")) {
  throw "secrets.ps1 tidak ditemukan di $PSScriptRoot"
}

. .\secrets.ps1

if (-not $env:GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
  throw "GOOGLE_SERVICE_ACCOUNT_KEY_PATH belum ada. Cek secrets.ps1"
}

if (-not (Test-Path $env:GOOGLE_SERVICE_ACCOUNT_KEY_PATH)) {
  throw "File service account tidak ditemukan: $env:GOOGLE_SERVICE_ACCOUNT_KEY_PATH"
}

if (-not $env:GOOGLE_MASTER_SHEET_ID) {
  throw "GOOGLE_MASTER_SHEET_ID belum ada. Cek secrets.ps1"
}

Write-Host "Secrets loaded for sheets-api"
Write-Host "Google key path: $env:GOOGLE_SERVICE_ACCOUNT_KEY_PATH"
Write-Host "Google master sheet: $env:GOOGLE_MASTER_SHEET_ID"
Write-Host "Starting sheets-api on port 3001..."

npm.cmd run sheets-api
