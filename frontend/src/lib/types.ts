export type Difficulty="easy"|"medium"|"hard";
export type Phase="planning"|"building"|"debugging";
export interface Challenge { id:string; title:string; type:string; difficulty:Difficulty; score:number; recommended_time_minutes:number; tags:string[]; problem_description:string; software_instructions?:string; interviewer_guidelines?:string; agent_config:{allowed_agents:string[]; token_budget:number; internet_enabled:boolean; model?:string|null; time_limit_minutes?:number|null; agent_mode?:string}; rubric_weights:{functional:number; ai_collaboration:number}; ide_setup:{install_command:string; run_command:string; test_command:string; default_open_files:string[]; read_only_files:string[]; hidden_files:string[]}; scoring?:{mode:string; format:string; scoring_command?:string|null; scoring_output_files:string[]}; }
export interface SessionEvent { id:string; attempt_id:string; session_id?:string; sequence:number; seq?:number; ts?:string; actor?:string; type:string; payload:Record<string,unknown>; }
export interface TokenBudget { budget:number; used:number; remaining:number; by_phase:Record<string,number>; budget_exceeded:boolean; hard_stop:boolean; }
export interface Replay { attempt_id:string; session_id:string; status:string; events:SessionEvent[]; git_snapshots:Record<string,unknown>[]; token_budget:TokenBudget; }
export interface ReportSignal { text:string; evidence_event_ids:string[]; }
export interface ReportMetrics { prompts_total:number; prompts_by_phase:Record<string,number>; tokens_used:number; token_budget:number; test_runs:number; files_edited:number; git_snapshots:number; duration_seconds:number; time_to_first_edit_seconds:number|null; }
export interface Report { attempt_id:string; challenge_id:string; candidate_name:string; functional_score:number; ai_collaboration_score:number; total_score:number; breakdown:{dimension:string; score:number; evidence_event_ids:string[]; notes:string}[]; timeline:SessionEvent[]; verdict?:string; signals?:ReportSignal[]; concerns?:ReportSignal[]; metrics?:ReportMetrics; }

// --- Live attempt/session contracts (backend overnight build) -------------
export interface Attempt { id:string; challenge_id:string; candidate_name:string; candidate_email:string; status:string; session_id:string; token_budget:number; tokens_used:number; tokens_by_phase:Record<string,number>; budget_exceeded:boolean; budget_hard_stop:boolean; started_at?:string|null; last_heartbeat_at?:string|null; time_limit_minutes?:number|null; expires_at?:string|null; events?:SessionEvent[]; }
export interface SessionStatus { attempt_id:string; status:string; started_at?:string|null; expires_at?:string|null; elapsed_seconds:number; remaining_seconds:number; time_limit_minutes?:number|null; budget:TokenBudget; sandbox_status:string; agent_mode?:string; }
export interface WorkspaceFile { path:string; size:number; read_only:boolean; hidden:boolean; }
export interface FileList { attempt_id:string; files:WorkspaceFile[]; }
export interface FileContent { path:string; content:string; read_only:boolean; }
export interface ScoreRun { id:string; command:string; exit_code:number; score:number|null; source:string; stdout_tail:string; ran_at:string; }
export interface ScoreSummary { attempt_id:string; latest:ScoreRun|null; runs:ScoreRun[]; }
export interface AgentStatus { configured:boolean; provider:string; model:string; }
export interface AgentChatResult { response_text:string; tokens_in:number; tokens_out:number; budget:TokenBudget; agent_mode?:string; symptom?:string; where?:string; hint?:string; guardrail_intervened?:boolean; tool_events?:SessionEvent[]; }
export interface PublicTestItem { name:string; status:string; expected:string; received:string; message:string; }
export interface PublicTests { attempt_id:string; run_id:string|null; tests:PublicTestItem[]; hidden:{ total:number; passed:number }; }
