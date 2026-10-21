from __future__ import annotations
import re, xml.etree.ElementTree as ET
from .models import DimensionScore, SessionEvent, EventType

def _safe_count(value) -> int:
    """Parse a JUnit count attribute; anything unparseable/negative is 0."""
    try: return max(0, int(value))
    except (TypeError, ValueError): return 0

def parse_junit_xml(xml_text: str) -> float:
    """Return 0-100 proportional score from JUnit/xUnit-style XML."""
    if not xml_text or not xml_text.strip(): return 0.0
    try: root=ET.fromstring(xml_text)
    except ET.ParseError: return 0.0
    suites=[root] if root.tag=="testsuite" else list(root.iter("testsuite"))
    # xUnit assemblies fallback: count test elements with result attr
    if not suites:
        tests=list(root.iter("test"))
        if tests:
            passed=sum(1 for t in tests if (t.get("result") or "").lower()=="pass")
            return round(100.0*passed/len(tests),2) if tests else 0.0
        return 0.0
    total=fail=err=skip=0
    for s in suites:
        total+=_safe_count(s.get("tests",0)); fail+=_safe_count(s.get("failures",0)); err+=_safe_count(s.get("errors",0)); skip+=_safe_count(s.get("skipped",0))
    if total==0:
        cases=list(root.iter("testcase"))
        if not cases: return 0.0
        failed=sum(1 for c in cases if c.find("failure") is not None or c.find("error") is not None)
        return round(100.0*(len(cases)-failed)/len(cases),2)
    passed=max(total-fail-err-skip,0)
    return round(100.0*passed/total,2)

def parse_tap(tap_text: str) -> float:
    if not tap_text: return 0.0
    ok=notok=0
    for line in tap_text.splitlines():
        s=line.strip()
        if s.startswith("not ok"): notok+=1
        elif s.startswith("ok " ) or s=="ok": ok+=1
    total=ok+notok
    return round(100.0*ok/total,2) if total else 0.0

_FS_RE=re.compile(r"FS_SCORE:\s*(\d+(?:\.\d+)?)\s*%")
def parse_fs_score(output: str) -> float | None:
    if not output: return None
    m=_FS_RE.search(output)
    if not m: return None
    return max(0.0,min(100.0,float(m.group(1))))

def compute_functional_score(junit_xml=None, tap_output=None, scorer_output=None, manual=None) -> float:
    if scorer_output:
        v=parse_fs_score(scorer_output)
        if v is not None: return v
    if junit_xml: return parse_junit_xml(junit_xml)
    if tap_output: return parse_tap(tap_output)
    if manual is not None: return max(0.0,min(100.0,float(manual)))
    return 0.0

def _ev(events, *types):
    tset=set(types); return [e for e in events if e.type in tset]

def compute_collaboration(events: list[SessionEvent]) -> tuple[float, list[DimensionScore]]:
    if not events:
        dims=[DimensionScore(dimension=d, score=0.0, evidence_event_ids=[], notes="No session events recorded.") for d in ["prompting","exploration","verification_testing","debugging","independence"]]
        return 0.0, dims
    # Prompting: count + specificity
    prompts=_ev(events, EventType.prompt)
    p_texts=[str(e.payload.get("text","")) for e in prompts]
    specific=sum(1 for t in p_texts if len(t)>=40 or any(k in t.lower() for k in [".py",".ts",".tsx","error","test","file","function","bug"]))
    prompting_score=min(100.0, len(prompts)*20 + specific*10) if prompts else 0.0
    # Exploration: distinct files viewed
    views=_ev(events, EventType.file_view)
    distinct_files={str(e.payload.get("path","")) for e in views if e.payload.get("path")}
    exploration_score=min(100.0, len(distinct_files)*25 + min(len(views),4)*5)
    # Verification: test runs + terminal verification
    tests=_ev(events, EventType.test_run)
    terms=_ev(events, EventType.terminal, EventType.terminal_cmd, EventType.terminal_output)
    verification_score=min(100.0, len(tests)*30 + len(terms)*5)
    # Debugging: edit->test cycles
    cycles=0; seen_edit=False
    for e in events:
        if e.type==EventType.file_edit: seen_edit=True
        elif e.type==EventType.test_run and seen_edit: cycles+=1; seen_edit=False
    debugging_score=min(100.0, cycles*35 + (10 if len(tests)>1 else 0))
    # Independence: own edits, iterative (not single dump)
    edits=_ev(events, EventType.file_edit)
    if not edits: independence_score=0.0
    else:
        independence_score=min(100.0, 40 + len(edits)*15) if len(edits)>=2 else 55.0
    dims=[
        DimensionScore(dimension="prompting", score=round(prompting_score,2), evidence_event_ids=[e.id for e in prompts], notes=f"{len(prompts)} prompts, {specific} specific."),
        DimensionScore(dimension="exploration", score=round(exploration_score,2), evidence_event_ids=[e.id for e in views], notes=f"{len(distinct_files)} distinct files viewed."),
        DimensionScore(dimension="verification_testing", score=round(verification_score,2), evidence_event_ids=[e.id for e in tests+terms], notes=f"{len(tests)} test runs."),
        DimensionScore(dimension="debugging", score=round(debugging_score,2), evidence_event_ids=[e.id for e in events if e.type in (EventType.file_edit, EventType.test_run)], notes=f"{cycles} edit->test cycles."),
        DimensionScore(dimension="independence", score=round(independence_score,2), evidence_event_ids=[e.id for e in edits], notes=f"{len(edits)} file edits."),
    ]
    weights={"prompting":0.25,"exploration":0.20,"verification_testing":0.20,"debugging":0.15,"independence":0.20}
    total=round(sum(d.score*weights[d.dimension] for d in dims),2)
    return total, dims
