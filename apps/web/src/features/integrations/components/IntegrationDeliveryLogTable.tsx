import React from 'react';

export interface IntegrationDeliveryLogItem {
  id: string;
  provider: string;
  eventType: string;
  status: 'PENDING' | 'PROCESSING' | 'RETRYING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  lastError?: string | null;
  createdAt: string;
}

interface Props {
  deliveries: IntegrationDeliveryLogItem[];
}

export const IntegrationDeliveryLogTable: React.FC<Props> = ({ deliveries }) => {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">Outbound Integration Delivery Audit</h3>

      {deliveries.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No delivery audit logs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-300">
            <thead className="border-b border-gray-800 bg-gray-950/40 text-gray-400 uppercase font-medium">
              <tr>
                <th className="p-3">Provider</th>
                <th className="p-3">Event</th>
                <th className="p-3">Status</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Error / Status Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60">
              {deliveries.map((item) => (
                <tr key={item.id} className="hover:bg-gray-800/30 transition">
                  <td className="p-3 font-semibold text-gray-200">{item.provider}</td>
                  <td className="p-3 font-mono text-gray-400">{item.eventType}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.status === 'SUCCESS'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : item.status === 'FAILED'
                          ? 'bg-rose-500/20 text-rose-400'
                          : item.status === 'PROCESSING'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="p-3">{item.attemptCount}</td>
                  <td className="p-3 text-gray-400">{new Date(item.createdAt).toLocaleTimeString()}</td>
                  <td className="p-3 text-rose-400 truncate max-w-xs">{item.lastError || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
