# OpenCode report loop package

This package creates and improves a LaTeX report using a bounded Writer -> Reviewer -> Fixer loop.

## Where to place it

Unzip this package so you get:

```text
M:\M77\P8_Project\report_ai\
M:\M77\P8_Project\report\
```

The package includes a starter report. If you already have a report, replace:

```text
M:\M77\P8_Project\report\report.tex
M:\M77\P8_Project\report\references.bib
```

with your own files.

## Run

From PowerShell:

```powershell
cd /d M:\M77\P8_Project\report_ai
.\run_report_loop.ps1 -Rounds 3
```

With a specific model:

```powershell
.\run_report_loop.ps1 -Rounds 3 -Model "openai/gpt-5.1"
```

If your project path is different:

```powershell
.\run_report_loop.ps1 -ProjectRoot "M:\M77\P8_Project" -Rounds 3
```

## Results and figures

Put exported CSV/JSON results here:

```text
M:\M77\P8_Project\report\results\
```

Put figures/screenshots here:

```text
M:\M77\P8_Project\report\figures\
```

The loop automatically attaches CSV, JSON, TXT, and Markdown files from the results folder.

## Safety

The script backs up report.tex before every round into:

```text
M:\M77\P8_Project\report\_ai_backups\
```
