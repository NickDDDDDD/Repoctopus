export type ActionType = 'invoke_skill' | 'call_tool' | 'ask_user' | 'checkpoint';

export interface WorkflowAction {
  type: ActionType;
  ref?: string;
  summary: string;
  evidenceProfile?: string;
}

export interface WorkflowStep {
  id: string;
  action: WorkflowAction;
  onSuccess: string | null;
  onFailure?: string;
}

export interface WorkflowGuardrails {
  allowedActionTypes: ActionType[];
  allowedRefs: string[];
  confirmationRequiredFor: string[];
  maxIterations: number;
  maxRetriesPerAction: number;
}

export interface WorkflowDefinition {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'Workflow';
  metadata: {
    name: string;
    version: string;
    description: string;
  };
  entry: string;
  steps: WorkflowStep[];
  guardrails: WorkflowGuardrails;
}

export interface WorkflowPackage {
  definition: WorkflowDefinition;
  digest: string;
}

export interface WorkflowValidationFinding {
  code: string;
  message: string;
  stepId?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  findings: WorkflowValidationFinding[];
}
