Set-Location "$PSScriptRoot\backend"
if (-not (Test-Path ".venv")) { py -m venv .venv }
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (-not (Test-Path ".env")) { Copy-Item .env.example .env; Write-Host "Created backend/.env — add your Supabase and Groq keys." }
python -m uvicorn app.main:app --reload --port 8000
