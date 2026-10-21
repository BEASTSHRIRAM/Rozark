# Rozark — Challenge Schema

Follows HackerRank's project-question flow, extended with `agent_config` and
`rubric_weights`. A challenge is a JSON document:

```json
{
  "title": "Fix the orders API pagination bug",
  "type": "backend",
  "difficulty": "medium",
  "score": 75,
  "recommended_time_minutes": 30,
  "tags": ["python", "fastapi", "debugging"],
  "problem_description": "Markdown problem statement...",
  "software_instructions": "Python 3.12, FastAPI",
  "interviewer_guidelines": "Internal notes, hints, reference solution pointers.",
  "environment": {"stack": "python-fastapi", "runtime": "ubuntu-24.04"},
  "project_setup": {
    "source": "sample",
    "github_url": null,
    "zip_filename": null
  },
  "ide_setup": {
    "install_command": "pip install -r requirements.txt",
    "run_command": "uvicorn app.main:app --port 8000",
    "test_command": "pytest -q",
    "default_open_files": ["README.md", "app/main.py"],
    "read_only_files": ["README.md"],
    "hidden_files": ["tests/test_hidden.py"]
  },
  "scoring": {
    "mode": "automated",
    "format": "junit",
    "scoring_command": "pytest --junitxml=results.xml",
    "scoring_output_files": ["results.xml"]
  },
  "agent_config": {
    "allowed_agents": ["claude_code", "codex"],
    "model": null,
    "token_budget": 100000,
    "time_limit_minutes": 30,
    "internet_enabled": false
  },
  "rubric_weights": {"functional": 0.4, "ai_collaboration": 0.6}
}
```

## Field notes
- `project_setup.source`: `upload_zip` (<=5MB, HackerRank parity) | `clone_github` | `sample`.
- `scoring.mode`: `automated` | `manual` | `custom`.
- `scoring.format`: `junit` | `xunit` | `tap` | `custom_fs_score`.
- Custom scorers must print exactly `FS_SCORE: XY%` (XY in 0..100).
- Difficulty defaults (HackerRank parity): easy 50pts/15m, medium 75/30m, hard 100/45-60m.
- Validation endpoint behaviour (MVP): Pydantic validates shape; a full
  "Validate + Try question" runner is future work.
