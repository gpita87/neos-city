# setup_git.ps1 -- one-shot git initialization for the Neos City project.
#
# Run this once from PowerShell in the project root:
#   cd C:\Users\pitag\Documents\neos-city
#   .\setup_git.ps1
#
# What it does:
#   1. Removes any half-initialized .git directory left behind by a failed init
#   2. Runs `git init -b main` and configures user.name / user.email
#   3. Sanity-checks that .env files are not about to be staged
#   4. Stages everything, makes the baseline commit
#   5. Prints next-step commands for creating the GitHub remote
#
# Idempotent: safe to re-run. If a real commit already exists it skips the init.

$ErrorActionPreference = 'Stop'

Write-Host "=== Neos City -- git setup ===" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Verify git is installed
# ---------------------------------------------------------------------------
try {
    $gitVersion = git --version
    Write-Host "[ok] $gitVersion" -ForegroundColor Green
}
catch {
    Write-Host "[FATAL] git is not installed or not on PATH." -ForegroundColor Red
    Write-Host "Install Git for Windows from https://git-scm.com/download/win and re-run."
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Clean up a half-initialized .git directory if present
# ---------------------------------------------------------------------------
if (Test-Path .git) {
    $hasObjects = Test-Path .git\objects
    if (-not $hasObjects) {
        Write-Host "[clean] Removing half-initialized .git directory..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force .git
    }
    else {
        Write-Host "[skip] .git already initialized with objects -- leaving it alone." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 3. git init (only if not already a real repo)
# ---------------------------------------------------------------------------
if (-not (Test-Path .git\objects)) {
    git init -b main
    git config user.name  "Gabriel"
    git config user.email "pita.gabriel25@gmail.com"
    Write-Host "[ok] git init -b main" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4. Sanity check -- no .env or node_modules should be tracked
# ---------------------------------------------------------------------------
git add -A --dry-run 2>&1 | Out-Null
$staged = git status --porcelain
$leaks  = $staged | Select-String -Pattern '(\.env($|\.|\s)|node_modules)'
if ($leaks) {
    Write-Host "[FATAL] .env or node_modules found in stage candidates:" -ForegroundColor Red
    $leaks | ForEach-Object { Write-Host "  $_" }
    Write-Host "Check your .gitignore. Aborting before commit." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 5. Stage everything and make the baseline commit (if HEAD does not exist yet)
# ---------------------------------------------------------------------------
$hasCommit = $false
try {
    git rev-parse HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $hasCommit = $true }
}
catch {
    $hasCommit = $false
}

if (-not $hasCommit) {
    git add -A
    $fileCount = (git diff --cached --numstat | Measure-Object).Count
    Write-Host "[stage] $fileCount files staged" -ForegroundColor Green

    # Verify .env files are NOT in the staged set (defense in depth)
    $envInStage = git diff --cached --name-only | Select-String -Pattern '(^|/)\.env($|\.local|\.production)'
    if ($envInStage) {
        Write-Host "[FATAL] .env files are staged -- aborting." -ForegroundColor Red
        $envInStage | ForEach-Object { Write-Host "  $_" }
        exit 1
    }

    $commitMsg = @"
Baseline: import existing Neos City project state

Captures the working tree as of 2026-04-30, prior to ongoing work on the
import pipeline overhaul. Includes backend, frontend, scripts, and
AGENT_CONTEXT.md (with secrets scrubbed). backend/.env stays gitignored
and out of history.
"@
    git commit -m $commitMsg
    Write-Host "[ok] baseline commit made" -ForegroundColor Green
}
else {
    Write-Host "[skip] HEAD already exists -- not making a new baseline commit." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Done. Local repo is set up. ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: create a private GitHub repo and push." -ForegroundColor White
Write-Host ""
Write-Host "Option A -- using gh CLI (recommended if installed):" -ForegroundColor White
Write-Host "    gh repo create neos-city --private --source=. --remote=origin --push" -ForegroundColor Gray
Write-Host ""
Write-Host "Option B -- manual:" -ForegroundColor White
Write-Host "    1. Go to https://github.com/new and create a private repo named 'neos-city'." -ForegroundColor Gray
Write-Host "       Do NOT initialize it with README/.gitignore/license." -ForegroundColor Gray
Write-Host "    2. Then run:" -ForegroundColor Gray
Write-Host "       git remote add origin https://github.com/<your-username>/neos-city.git" -ForegroundColor Gray
Write-Host "       git push -u origin main" -ForegroundColor Gray
Write-Host ""
Write-Host "Verify: 'git log --oneline' and 'git status' should both look clean." -ForegroundColor White
