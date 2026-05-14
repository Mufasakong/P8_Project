# OpenCode report loop scripts

Drop this `report_ai` folder next to your report folder.

Default expected folders:

```text
M:\M77\P8_Project\report\
M:\M77\P8_Project\report_ai\
```

Your report folder should contain:

```text
report.tex
references.bib
results\   optional CSV/JSON/TXT/MD files
```

Run from PowerShell:

```powershell
cd /d M:\M77\P8_Project\report_ai
.\run_report_loop.ps1 -Rounds 3
```

With a specific model:

```powershell
.\run_report_loop.ps1 -Rounds 3 -Model "openai/gpt-5.1"
```

With auto-approval, only in a backed-up/git-controlled folder:

```powershell
.\run_report_loop.ps1 -Rounds 3 -AutoApprove
```

The script creates backups in:

```text
M:\M77\P8_Project\report\_ai_backups\
```
