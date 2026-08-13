Set-Location "$PSScriptRoot\frontend"
npm install
if (-not (Test-Path ".env")) { Copy-Item .env.example .env; Write-Host "Created frontend/.env — add your Supabase public values." }
npm run dev
