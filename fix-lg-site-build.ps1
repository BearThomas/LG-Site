$ErrorActionPreference = 'Stop'

Write-Host 'Repairing LG-Site Cloudflare Pages build (v2)...' -ForegroundColor Cyan

$required = @('package.json', 'functions', 'migrations', 'scripts/check-project.mjs')
foreach ($item in $required) {
    if (-not (Test-Path $item)) {
        throw "Run this script from the LG-Site repository root. Missing: $item"
    }
}

# These are obsolete after moving from Netlify/Appwrite Database to Pages Functions + D1.
# public/data-backups is intentionally NOT touched.
$obsoletePaths = @(
    'functions/api/d1.js',
    'functions/_lib/documents.js',
    'functions/_lib/permissions.js',
    'netlify',
    '.netlify',
    'netlify.toml',
    'deno.lock',
    'wrangler.json',
    'wrangler.toml',
    'scripts/appwrite-client.js',
    'scripts/create-comments-table.js',
    'scripts/create-confession-table.js',
    'scripts/create-posts-table.js',
    'scripts/create-users-table.js',
    'migration/SOURCE_INVENTORY.json',
    'migration/TRANSFORMATION_REPORT.md'
)

foreach ($path in $obsoletePaths) {
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        Write-Host "Removed obsolete path: $path" -ForegroundColor Yellow
    }
}

# .env and .dev.vars are valid local-only secret files when they are gitignored.
# The old checker incorrectly rejected their mere presence.
$checkerPath = Join-Path (Get-Location) 'scripts/check-project.mjs'
$checker = [System.IO.File]::ReadAllText($checkerPath)
$oldLine = "for (const forbidden of ['.env', '.dev.vars', 'netlify.toml', 'deno.lock']) {"
$newLine = "for (const forbidden of ['netlify.toml', 'deno.lock']) {"
if ($checker.Contains($oldLine)) {
    $checker = $checker.Replace($oldLine, $newLine)
    [System.IO.File]::WriteAllText($checkerPath, $checker, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host 'Updated project checker to allow local .env/.dev.vars files.' -ForegroundColor Green
}

# Make sure local secrets and generated artifacts are ignored by Git.
$gitignorePath = Join-Path (Get-Location) '.gitignore'
$gitignore = if (Test-Path $gitignorePath) { [System.IO.File]::ReadAllText($gitignorePath) } else { '' }
$requiredIgnoreLines = @(
    '.env',
    '.env.*',
    '!.env.example',
    '.dev.vars',
    '.dev.vars.*',
    '!.dev.vars.example',
    'node_modules/',
    'dist/',
    '.wrangler/',
    '*.log'
)
foreach ($line in $requiredIgnoreLines) {
    if (($gitignore -split "`r?`n") -notcontains $line) {
        if ($gitignore.Length -gt 0 -and -not $gitignore.EndsWith("`n")) { $gitignore += "`r`n" }
        $gitignore += "$line`r`n"
    }
}
[System.IO.File]::WriteAllText($gitignorePath, $gitignore, (New-Object System.Text.UTF8Encoding($false)))

@'
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "lg-site",
  "compatibility_date": "2026-07-15",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "./dist",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "lg",
      "database_id": "31e5fcd9-e15b-492c-90d3-c4119fa7f39a",
      "migrations_dir": "migrations"
    }
  ],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
'@ | Set-Content -Path 'wrangler.jsonc' -Encoding utf8

Write-Host 'Wrote wrangler.jsonc.' -ForegroundColor Green
Write-Host 'Local .env and .dev.vars were preserved.' -ForegroundColor Green
Write-Host 'public/data-backups was preserved.' -ForegroundColor Green

npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

npm run check
if ($LASTEXITCODE -ne 0) { throw 'npm run check failed.' }

Remove-Item '.functions-build' -Recurse -Force -ErrorAction SilentlyContinue
npx wrangler pages functions build functions --outdir .functions-build --project-directory . --build-output-directory dist
if ($LASTEXITCODE -ne 0) { throw 'Pages Functions build failed.' }

Write-Host ''
Write-Host 'Repair completed successfully.' -ForegroundColor Green
Write-Host 'Now record all deletions and fixes in Git:' -ForegroundColor Cyan
Write-Host '  git add -A'
Write-Host '  git commit -m "Remove legacy Netlify backend and fix Pages build"'
Write-Host '  git push'