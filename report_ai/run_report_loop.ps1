param(
    [string]$ReportDir = "M:\M77\P8_Project\report",
    [string]$AiDir = "M:\M77\P8_Project\report_ai",
    [int]$Rounds = 3,
    [string]$Model = "",
    [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"

function Run-OpenCodePrompt {
    param(
        [string]$PromptFile,
        [string]$Title
    )

    Write-Host ""
    Write-Host "============================================================"
    Write-Host $Title
    Write-Host "============================================================"

    $promptText = Get-Content $PromptFile -Raw

    $args = @("run")

    if ($Model -ne "") {
        $args += @("-m", $Model)
    }

    $coreFiles = @(
        (Join-Path $ReportDir "report.tex"),
        (Join-Path $ReportDir "references.bib"),
        (Join-Path $AiDir "rubric.md"),
        (Join-Path $AiDir "project_context.md")
    )

    foreach ($f in $coreFiles) {
        if (Test-Path $f) {
            $args += @("-f", $f)
        }
        else {
            Write-Host "Warning: missing file $f"
        }
    }

    $reviewFile = Join-Path $ReportDir "review_latest.md"
    if (Test-Path $reviewFile) {
        $args += @("-f", $reviewFile)
    }

    $resultsDir = Join-Path $ReportDir "results"
    if (Test-Path $resultsDir) {
        Get-ChildItem $resultsDir -File -Recurse | Where-Object {
            $_.Extension -in @(".csv", ".json", ".txt", ".md")
        } | ForEach-Object {
            $args += @("-f", $_.FullName)
        }
    }

    if ($AutoApprove) {
        $args += "--dangerously-skip-permissions"
    }

    $args += $promptText

    Push-Location $ReportDir
    try {
        & opencode @args
    }
    finally {
        Pop-Location
    }
}

function Backup-Report {
    param([int]$Round)

    $backupDir = Join-Path $ReportDir "_ai_backups"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $src = Join-Path $ReportDir "report.tex"
    $dst = Join-Path $backupDir "report_round${Round}_$stamp.tex"

    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "Backup created: $dst"
    }
    else {
        Write-Host "Warning: report.tex not found at $src"
    }
}

function Try-Compile {
    Write-Host ""
    Write-Host "Compiling LaTeX..."

    Push-Location $ReportDir
    try {
        if (Get-Command latexmk -ErrorAction SilentlyContinue) {
            & latexmk -pdf -interaction=nonstopmode report.tex
        }
        else {
            & pdflatex -interaction=nonstopmode report.tex
            if (Test-Path "report.aux") {
                & bibtex report
            }
            & pdflatex -interaction=nonstopmode report.tex
            & pdflatex -interaction=nonstopmode report.tex
        }
    }
    catch {
        Write-Host "LaTeX compile failed. Check report.log. Continuing loop."
    }
    finally {
        Pop-Location
    }
}

Write-Host "Report directory: $ReportDir"
Write-Host "AI directory: $AiDir"
Write-Host "Rounds: $Rounds"

for ($i = 1; $i -le $Rounds; $i++) {
    Write-Host ""
    Write-Host "############################################################"
    Write-Host "ROUND $i"
    Write-Host "############################################################"

    Backup-Report -Round $i

    Run-OpenCodePrompt `
        -PromptFile (Join-Path $AiDir "prompts\writer.md") `
        -Title "ROUND $i - WRITER"

    Try-Compile

    Run-OpenCodePrompt `
        -PromptFile (Join-Path $AiDir "prompts\reviewer.md") `
        -Title "ROUND $i - REVIEWER"

    Run-OpenCodePrompt `
        -PromptFile (Join-Path $AiDir "prompts\fixer.md") `
        -Title "ROUND $i - FIXER"

    Try-Compile
}

Write-Host ""
Write-Host "Done. Check report.tex, review_latest.md, and _ai_backups."
