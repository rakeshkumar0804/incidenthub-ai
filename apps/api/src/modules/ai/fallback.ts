import type {
  AIInvestigationInput,
  AIInvestigationOutput,
  SupportingEvidenceItem,
  RecommendedActionItem,
  AlternativeHypothesisItem,
} from './ai.types';

/**
 * Pure deterministic offline investigation engine.
 * Given identical normalized input, returns bitwise identical output.
 * Never invents facts, timestamps, or ungrounded infrastructure failures.
 */
export function evaluateDeterministicInvestigation(
  input: AIInvestigationInput,
): AIInvestigationOutput {
  const evidenceList = input.evidenceList || [];

  if (evidenceList.length === 0) {
    return {
      incidentSummary: `Incident ${input.incident.number} (${input.incident.title}) has zero eligible evidence signals.`,
      probableRootCause: 'Insufficient evidence: No evidence-backed root-cause hypothesis can be produced.',
      confidence: 0.0,
      confidenceTier: 'UNCERTAIN',
      supportingEvidence: [],
      contradictoryEvidence: [],
      alternativeHypotheses: [],
      impactAssessment: `Impact reported on ${input.incident.projectName} (${input.incident.severity} in ${input.incident.environment}).`,
      riskAssessment: 'UNCERTAIN — Awaiting telemetry or manual evidence signals',
      recommendedActions: [
        {
          action: 'Verify telemetry integrations and review error monitoring dashboards',
          priority: 'HIGH',
          category: 'INVESTIGATION',
        },
      ],
      uncertainty: ['No eligible correlation or manual evidence records available for this incident.'],
      investigationLimitations: 'Zero correlation signals available in database.',
    };
  }

  const highTier = evidenceList.filter((e) => e.confidenceTier === 'HIGH');
  const medTier = evidenceList.filter((e) => e.confidenceTier === 'MEDIUM');

  const deployments = evidenceList.filter((e) => e.type === 'GITHUB_DEPLOYMENT');
  const sentryErrors = evidenceList.filter((e) => e.type === 'SENTRY_ERROR');
  const commits = evidenceList.filter((e) => e.type === 'GITHUB_COMMIT');
  const workflows = evidenceList.filter((e) => e.type === 'GITHUB_WORKFLOW_RUN');
  const pullRequests = evidenceList.filter((e) => e.type === 'GITHUB_PR');
  const manuals = evidenceList.filter((e) => e.type === 'MANUAL');

  const topDeploy =
    deployments.find((e) => e.confidenceTier === 'HIGH') ||
    deployments.find((e) => e.confidenceTier === 'MEDIUM') ||
    deployments[0];

  const topSentry =
    sentryErrors.find((e) => e.confidenceTier === 'HIGH') ||
    sentryErrors.find((e) => e.confidenceTier === 'MEDIUM') ||
    sentryErrors[0];

  const topCommit =
    commits.find((e) => e.confidenceTier === 'HIGH') ||
    commits.find((e) => e.confidenceTier === 'MEDIUM') ||
    commits[0];

  const topWorkflow =
    workflows.find((e) => e.confidenceTier === 'HIGH') ||
    workflows.find((e) => e.confidenceTier === 'MEDIUM') ||
    workflows[0];

  const topPR =
    pullRequests.find((e) => e.confidenceTier === 'HIGH') ||
    pullRequests.find((e) => e.confidenceTier === 'MEDIUM') ||
    pullRequests[0];

  let summary = `Incident ${input.incident.number} (${input.incident.title}) occurred in ${input.incident.environment}.`;
  let probableRootCause = 'Leading hypothesis: Multi-signal correlation detected proximate to incident onset.';
  let rawConfidence = 0.35;
  const supportingEvidence: SupportingEvidenceItem[] = [];
  const alternativeHypotheses: AlternativeHypothesisItem[] = [];
  const recommendedActions: RecommendedActionItem[] = [];
  const uncertainty: string[] = [];

  if (topDeploy && topSentry) {
    probableRootCause = `Leading hypothesis: Deployment "${topDeploy.title}" correlates with Sentry exception spike "${topSentry.title}".`;
    summary = `Recent deployment correlates with automated Sentry exception spike in ${input.incident.environment}.`;
    rawConfidence = 0.85;

    supportingEvidence.push({
      evidenceId: topDeploy.id,
      claim: `Deployment "${topDeploy.title}" occurred preceding incident onset.`,
      relevanceReason: `Grounding score ${topDeploy.confidence ?? 0} (${topDeploy.confidenceTier ?? 'MEDIUM'})`,
    });
    supportingEvidence.push({
      evidenceId: topSentry.id,
      claim: `Exception spike "${topSentry.title}" detected around incident onset.`,
      relevanceReason: `Grounding score ${topSentry.confidence ?? 0} (${topSentry.confidenceTier ?? 'MEDIUM'})`,
    });

    if (topCommit && topCommit.id !== topDeploy.id) {
      alternativeHypotheses.push({
        hypothesis: `Isolated commit "${topCommit.title}" independent of deployment pipeline`,
        likelihood: 'LOW',
        evidenceIds: [topCommit.id],
      });
    }

    recommendedActions.push({
      action: 'Roll back recent deployment if error rate persists above baseline',
      priority: 'IMMEDIATE',
      category: 'MITIGATION',
    });
    recommendedActions.push({
      action: 'Inspect application stack traces and runtime exception logs',
      priority: 'HIGH',
      category: 'INVESTIGATION',
    });
  } else if (topDeploy) {
    probableRootCause = `Leading hypothesis: Deployment "${topDeploy.title}" correlates temporally with incident onset in ${input.incident.environment}.`;
    summary = `Deployment correlates with incident onset.`;
    rawConfidence = 0.70;

    supportingEvidence.push({
      evidenceId: topDeploy.id,
      claim: `Preceding deployment "${topDeploy.title}"`,
      relevanceReason: `Grounding score ${topDeploy.confidence ?? 0} (${topDeploy.confidenceTier ?? 'MEDIUM'})`,
    });

    recommendedActions.push({
      action: 'Verify deployed service health and consider rollback if telemetry degrades',
      priority: 'HIGH',
      category: 'MITIGATION',
    });
    recommendedActions.push({
      action: 'Inspect deployment commit log and configuration diffs',
      priority: 'HIGH',
      category: 'INVESTIGATION',
    });
  } else if (topSentry) {
    probableRootCause = `Leading hypothesis: Sentry error spike "${topSentry.title}" indicates runtime exception failure.`;
    summary = `Sentry exception spike correlates with active incident.`;
    rawConfidence = 0.65;

    supportingEvidence.push({
      evidenceId: topSentry.id,
      claim: `Runtime error event "${topSentry.title}"`,
      relevanceReason: `Grounding score ${topSentry.confidence ?? 0} (${topSentry.confidenceTier ?? 'MEDIUM'})`,
    });

    recommendedActions.push({
      action: 'Inspect error stack trace and reproduce failure scenario locally',
      priority: 'HIGH',
      category: 'INVESTIGATION',
    });
  } else if (topCommit) {
    probableRootCause = `Leading hypothesis: Commit "${topCommit.title}" contains code changes proximate to incident onset.`;
    summary = `Code commit correlates temporally with incident onset.`;
    rawConfidence = 0.55;

    supportingEvidence.push({
      evidenceId: topCommit.id,
      claim: `Proximate code commit "${topCommit.title}"`,
      relevanceReason: `Grounding score ${topCommit.confidence ?? 0} (${topCommit.confidenceTier ?? 'MEDIUM'})`,
    });

    recommendedActions.push({
      action: 'Review pull request and commit diffs for recent regressions',
      priority: 'MEDIUM',
      category: 'INVESTIGATION',
    });
  } else if (topWorkflow) {
    probableRootCause = `Leading hypothesis: Workflow failure "${topWorkflow.title}" indicates CI/CD build or deployment pipeline regression.`;
    summary = `GitHub workflow run failure correlates with incident onset.`;
    rawConfidence = 0.50;

    supportingEvidence.push({
      evidenceId: topWorkflow.id,
      claim: `Workflow run failure "${topWorkflow.title}"`,
      relevanceReason: `Grounding score ${topWorkflow.confidence ?? 0} (${topWorkflow.confidenceTier ?? 'MEDIUM'})`,
    });

    recommendedActions.push({
      action: 'Check CI/CD workflow logs and test step failures',
      priority: 'MEDIUM',
      category: 'INVESTIGATION',
    });
  } else if (topPR) {
    probableRootCause = `Leading hypothesis: Pull request "${topPR.title}" correlates with incident timeline.`;
    summary = `Merged pull request activity detected proximate to incident onset.`;
    rawConfidence = 0.45;

    const prNum = topPR.metadata && typeof topPR.metadata === 'object' && 'number' in topPR.metadata ? String(topPR.metadata.number) : '';
    supportingEvidence.push({
      evidenceId: topPR.id,
      claim: prNum ? `Pull request #${prNum} "${topPR.title}"` : `Pull request "${topPR.title}"`,
      relevanceReason: `Grounding score ${topPR.confidence ?? 0}`,
    });

    recommendedActions.push({
      action: 'Review PR discussion and changed files',
      priority: 'MEDIUM',
      category: 'INVESTIGATION',
    });
  } else if (manuals.length > 0 && manuals[0]) {
    const firstManual = manuals[0];
    probableRootCause = `Leading hypothesis: Human operator note "${firstManual.title}".`;
    summary = `Manual investigation evidence provided by responder.`;
    rawConfidence = 0.45;

    supportingEvidence.push({
      evidenceId: firstManual.id,
      claim: firstManual.title,
      relevanceReason: 'Manual responder note',
    });

    recommendedActions.push({
      action: 'Follow up on manual responder observations',
      priority: 'MEDIUM',
      category: 'INVESTIGATION',
    });
  } else if (evidenceList[0]) {
    const firstEvidence = evidenceList[0];
    supportingEvidence.push({
      evidenceId: firstEvidence.id,
      claim: firstEvidence.title,
      relevanceReason: `Grounding score ${firstEvidence.confidence ?? 0}`,
    });

    recommendedActions.push({
      action: 'Inspect system observability dashboards and service logs',
      priority: 'HIGH',
      category: 'INVESTIGATION',
    });
  }

  // Populate remaining high/medium signals if space permits
  for (const sig of highTier.concat(medTier)) {
    if (supportingEvidence.length < 5 && !supportingEvidence.some((s) => s.evidenceId === sig.id)) {
      supportingEvidence.push({
        evidenceId: sig.id,
        claim: sig.title,
        relevanceReason: `Correlated signal with confidence ${sig.confidence ?? 0}`,
      });
    }
  }

  if (evidenceList.length < 3) {
    uncertainty.push('Limited evidence signals available; hypothesis is preliminary.');
  }

  let confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN' = 'LOW';
  if (rawConfidence >= 0.8) confidenceTier = 'HIGH';
  else if (rawConfidence >= 0.5) confidenceTier = 'MEDIUM';
  else if (rawConfidence >= 0.2) confidenceTier = 'LOW';
  else confidenceTier = 'UNCERTAIN';

  return {
    incidentSummary: summary,
    probableRootCause,
    confidence: rawConfidence,
    confidenceTier,
    supportingEvidence,
    contradictoryEvidence: [],
    alternativeHypotheses,
    impactAssessment: `Impact reported on ${input.incident.projectName} (${input.incident.severity} in ${input.incident.environment}).`,
    riskAssessment:
      confidenceTier === 'HIGH'
        ? 'HIGH — Active regression in production environment'
        : 'MEDIUM — Operational investigation in progress',
    recommendedActions,
    uncertainty,
    investigationLimitations: 'Analysis generated from deterministic evaluation of correlated signals without live provider inference.',
  };
}
