export type Difficulty="easy"|"medium"|"hard";
export type Phase="planning"|"building"|"debugging";
export interface Challenge { id:string; title:string; type:string; difficulty:Difficulty; score:number; recommended_time_minutes:number; tags:string[]; problem_description:string; agent_config:{allowed_agents:string[]; token_budget:number; internet_enabled:boolean}; rubric_weights:{functional:number; ai_collaboration:number}; ide_setup:{install_command:string; run_command:string; test_command:string; default_open_files:string[]; read_only_files:string[]; hidden_files:string[]}; }
export interface SessionEvent { id:string; attempt_id:string; session_id?:string; sequence:number; seq?:number; ts?:string; actor?:string; type:string; payload:Record<string,unknown>; }
export interface TokenBudget { budget:number; used:number; remaining:number; by_phase:Record<string,number>; budget_exceeded:boolean; hard_stop:boolean; }
export interface Replay { attempt_id:string; session_id:string; status:string; events:SessionEvent[]; git_snapshots:Record<string,unknown>[]; token_budget:TokenBudget; }
export interface Report { attempt_id:string; challenge_id:string; candidate_name:string; functional_score:number; ai_collaboration_score:number; total_score:number; breakdown:{dimension:string; score:number; evidence_event_ids:string[]; notes:string}[]; timeline:SessionEvent[]; }
