import { IncidentSeverity, IncidentStatus } from '@incidenthub/shared';

export class SlackBlockKit {
  public static buildIncidentNotification(
    eventType: 'INCIDENT_CREATED' | 'SEVERITY_CHANGED' | 'STATUS_CHANGED' | 'INCIDENT_RESOLVED',
    incident: {
      id: string;
      number: number;
      title: string;
      severity: IncidentSeverity;
      status: IncidentStatus;
      environment: string;
      clientUrl: string;
    },
  ): Record<string, unknown>[] {
    const incidentNumStr = `INC-${String(incident.number).padStart(4, '0')}`;
    const incidentUrl = `${incident.clientUrl}/incidents/${incident.id}`;

    const severityColorEmoji =
      incident.severity === IncidentSeverity.SEV1
        ? '🔴 *SEV1 — Critical Outage*'
        : incident.severity === IncidentSeverity.SEV2
        ? '🟠 *SEV2 — High Impact*'
        : incident.severity === IncidentSeverity.SEV3
        ? '🟡 *SEV3 — Medium Impact*'
        : '🔵 *SEV4 — Low Impact*';

    const headerText =
      eventType === 'INCIDENT_CREATED'
        ? `🚨 *New Incident Declared: ${incidentNumStr}*`
        : eventType === 'SEVERITY_CHANGED'
        ? `⚠️ *Incident Severity Updated: ${incidentNumStr}*`
        : eventType === 'STATUS_CHANGED'
        ? `🔄 *Incident Status Updated: ${incidentNumStr}*`
        : `✅ *Incident Resolved: ${incidentNumStr}*`;

    const blocks: Record<string, unknown>[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${headerText.replace(/\*/g, '')}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Title:*\n<${incidentUrl}|${incident.title}>` },
          { type: 'mrkdwn', text: `*Severity:*\n${severityColorEmoji}` },
          { type: 'mrkdwn', text: `*Status:*\n\`${incident.status}\`` },
          { type: 'mrkdwn', text: `*Environment:*\n\`${incident.environment}\`` },
        ],
      },
    ];

    if (incident.status !== IncidentStatus.RESOLVED) {
      blocks.push({
        type: 'actions',
        block_id: 'incident_actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
            style: 'primary',
            action_id: 'ack_incident',
            value: incident.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Mitigate', emoji: true },
            action_id: 'mitigate_incident',
            value: incident.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Resolve', emoji: true },
            style: 'danger',
            action_id: 'resolve_incident',
            value: incident.id,
          },
        ],
      });
    }

    return blocks;
  }
}
