# run_known_player_merges.ps1
#
# One-shot runner for the 2026-05-04 batch of confirmed player merges
# surfaced by the duplicate-display_name dup query. Halts on the first
# failure so a partial merge can't quietly corrupt later steps.
#
# Confirmed mappings (signed off by Gabriel):
#   brodz       → brodzpm           (offline-only)
#   double      → double_fgc        (offline-only)
#   rubs        → rubs95            (offline-only)
#   tecmo       → tecmo562          (offline-only)
#   comboster7  → littlehomiejuan   (display_name match)
#   godofhay    → jammyjamjaml      (display_name match)
#   jamm        → jamm_             (offline-only side)
#   jammj       → jamm_             (online→online, via merge_players.js)
#   magicrock   → jukem             (with --display-name Jukem)
#   shadowcat   → SKIPPED (different humans, leave 4791 / 5374 alone)
#
# After all merges, runs recalculate_elo.js to re-derive ELO history for
# the consolidated jamm_ row (the online→online merge moved elo_history
# rows that need re-computation).
#
# Run from the neos-city directory:
#   .\run_known_player_merges.ps1
#
# Each link_offline_player.js / merge_players.js call uses --yes to skip
# the per-merge confirmation prompt. Gabriel already confirmed every pair
# in chat; the prompts would be redundant.

$ErrorActionPreference = 'Stop'

function Run-Step {
    param([string]$Label, [string[]]$Args)
    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    Write-Host "node $($Args -join ' ')" -ForegroundColor DarkGray
    & node @Args
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Step failed (exit $LASTEXITCODE). Halting." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# --- A. Clear offline → online merges -------------------------------------
Run-Step "A1 brodz → brodzpm"          @('link_offline_player.js', 'brodz',      'brodzpm',         '--yes')
Run-Step "A2 double → double_fgc"      @('link_offline_player.js', 'double',     'double_fgc',      '--yes')
Run-Step "A3 rubs → rubs95"            @('link_offline_player.js', 'rubs',       'rubs95',          '--yes')
Run-Step "A4 tecmo → tecmo562"         @('link_offline_player.js', 'tecmo',      'tecmo562',        '--yes')

# --- B. display_name-matched (different challonge_username) ---------------
Run-Step "B1 comboster7 → littlehomiejuan" @('link_offline_player.js', 'comboster7', 'littlehomiejuan', '--yes')
Run-Step "B2 godofhay → jammyjamjaml"      @('link_offline_player.js', 'godofhay',   'jammyjamjaml',    '--yes')

# --- C. jamm three-way (5137:jamm_ canonical) -----------------------------
Run-Step "C1 jamm (offline 8640) → jamm_"  @('link_offline_player.js', 'jamm',  'jamm_', '--yes')
Run-Step "C2 jammj (online 5869) → jamm_"  @('merge_players.js',       'jammj', 'jamm_')

# --- D. thankswalot — magicrock → jukem, fix display_name ----------------
Run-Step "D1 magicrock → jukem (display Jukem)" @('link_offline_player.js', 'magicrock', 'jukem', '--display-name', 'Jukem', '--yes')

# --- E. Re-derive ELO after online→online merge ---------------------------
Run-Step "E recalculate_elo.js" @('recalculate_elo.js')

Write-Host ""
Write-Host "All merges complete." -ForegroundColor Green
