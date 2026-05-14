param(
    [string]$ProjectRoot = "M:\M77\P8_Project",
    [string]$ReportDir = "",
    [string]$AiDir = "",
    [int]$Rounds = 3,
    [string]$Model = "",
    [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"

if ($ReportDir -eq "") { $ReportDir = Join-Path $ProjectRoot "report" }
if ($AiDir -eq "") { $AiDir = Join-Path $ProjectRoot "report_ai" }

function Ensure-Report-Files {
    if (!(Test-Path $ReportDir)) {
        New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
    }
    if (!(Test-Path (Join-Path $ReportDir "figures"))) {
        New-Item -ItemType Directory -Force -Path (Join-Path $ReportDir "figures") | Out-Null
    }
    if (!(Test-Path (Join-Path $ReportDir "results"))) {
        New-Item -ItemType Directory -Force -Path (Join-Path $ReportDir "results") | Out-Null
    }

    $reportPath = Join-Path $ReportDir "report.tex"
    $bibPath = Join-Path $ReportDir "references.bib"

    if (!(Test-Path $reportPath)) {
        Write-Host "report.tex not found. Creating starter report.tex"
        Copy-Item (Join-Path $AiDir "starter_report.tex") $reportPath -Force
    }

    if (!(Test-Path $bibPath)) {
        Write-Host "references.bib not found. Creating starter references.bib"
        Copy-Item (Join-Path $AiDir "starter_references.bib") $bibPath -Force
    }
}

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

    # Attach core files.
    $args += @("-f", (Join-Path $ReportDir "report.tex"))
    $args += @("-f", (Join-Path $ReportDir "references.bib"))
    $args += @("-f", (Join-Path $AiDir "rubric.md"))
    $args += @("-f", (Join-Path $AiDir "project_context.md"))

    # Attach review file if it exists.
    $reviewFile = Join-Path $ReportDir "review_latest.md"
    if (Test-Path $reviewFile) {
        $args += @("-f", $reviewFile)
    }

    # Attach result files if they exist.
    $resultsDir = Join-Path $ReportDir "results"
    if (Test-Path $resultsDir) {
        Get-ChildItem $resultsDir -File -Recurse | Where-Object { $_.Extension -in ".csv", ".json", ".txt", ".md" } | ForEach-Object {
            $args += @("-f", $_.FullName)
        }
    }

    # Attach figure captions/readme if present.
    $figuresDir = Join-Path $ReportDir "figures"
    if (Test-Path $figuresDir) {
        Get-ChildItem $figuresDir -File -Recurse | Where-Object { $_.Extension -in ".txt", ".md" } | ForEach-Object {
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

    Copy-Item $src $dst -Force
    Write-Host "Backup created: $dst"
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
        Write-Host "LaTeX compile failed. Check report.log. Continuing so reviewer can still inspect the text."
    }
    finally {
        Pop-Location
    }
}

Ensure-Report-Files

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
