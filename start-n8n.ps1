# Wariskan — n8n startup script
# Usage: .\start-n8n.ps1

# Load secrets dari file terpisah (tidak di-commit ke git)
$secretsFile = Join-Path $PSScriptRoot "secrets.ps1"
if (Test-Path $secretsFile) {
  . $secretsFile
  Write-Host "Secrets loaded from secrets.ps1" -ForegroundColor Green
} else {
  Write-Host "WARNING: secrets.ps1 tidak ditemukan!" -ForegroundColor Red
  Write-Host "Salin secrets.example.ps1 jadi secrets.ps1 lalu isi dengan key kamu." -ForegroundColor Yellow
  exit 1
}

# ── Rate limiting ─────────────────────────────────────────────
$env:WH_RATE_LIMIT_PER_MIN = "30"

# ── n8n internals ─────────────────────────────────────────────
$env:N8N_COMMUNITY_PACKAGES_ENABLED = "false"
$env:N8N_HIRING_BANNER_ENABLED      = "false"
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE   = "false"
$env:npm_config_cache               = Join-Path $PSScriptRoot ".npm-cache"

Write-Host "Starting n8n v2.18.5..." -ForegroundColor Cyan
npx.cmd --yes n8n@2.18.5 start
