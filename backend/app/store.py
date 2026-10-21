import itertools
from .models import Challenge, Attempt, Report
class Store:
    def __init__(self):
        self.challenges: dict[str,Challenge]={}
        self.attempts: dict[str,Attempt]={}
        self.reports: dict[str,Report]={}
        self._c=itertools.count(1); self._a=itertools.count(1); self._e=itertools.count(1)
    def next_challenge_id(self): return f"chal_{next(self._c):04d}"
    def next_attempt_id(self): return f"att_{next(self._a):04d}"
    def next_event_id(self): return f"evt_{next(self._e):04d}"
store=Store()
