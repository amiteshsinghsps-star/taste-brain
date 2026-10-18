import React, { useState } from 'react';
import { History, Search, Filter, Eye, EyeOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface AuditLogsPageProps {
  auditLogs: any[];
}

export const AuditLogsPage: React.FC<AuditLogsPageProps> = ({ auditLogs }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [expandedLogIds, setExpandedLogIds] = useState<string[]>([]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      !searchQuery ||
      log.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.agent?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      JSON.stringify(log.details)?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'ALL' ||
      (selectedCategory === 'AGENT' && log.action?.includes('AGENT')) ||
      (selectedCategory === 'EMAIL' && log.action?.includes('EMAIL')) ||
      (selectedCategory === 'ACCESS' && log.action?.includes('SCOPE'));

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <History className="h-5 w-5 text-indigo-600" /> Audit Native Activity Log
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Append-only audit trail retaining every decision, grant, mode change, and agent action</p>
        </div>
        <Badge variant="success" className="text-xs px-3 py-1 self-start sm:self-auto">
          Audit Rows Append-Only by API
        </Badge>
      </div>

      {/* Main Audit Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-xs space-y-4 p-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="relative flex-1 w-full">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
            <Input
              placeholder="Search audit actions, agent names, or payload details..."
              className="pl-9 h-10 rounded-xl text-xs bg-slate-50 border-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 shrink-0">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1" />
            {['ALL', 'AGENT', 'EMAIL', 'ACCESS'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors shrink-0 ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <Table>
          <TableHeader className="bg-slate-50/40 border-b border-slate-100">
            <TableRow className="border-b border-slate-100 hover:bg-transparent">
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Timestamp</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Action Event</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Agent / Module</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Details Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.map((log) => {
              const isExpanded = expandedLogIds.includes(log.id);
              const keyCount = log.details ? Object.keys(log.details).length : 0;

              return (
                <TableRow key={log.id} className="border-b border-slate-100/80 hover:bg-slate-50/50 transition-colors">
                  <TableCell className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap font-medium align-top">
                    {new Date(log.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="px-6 py-4 font-bold text-xs text-slate-900 align-top">
                    {log.action}
                  </TableCell>
                  <TableCell className="px-6 py-4 align-top">
                    <Badge variant="secondary" className="text-[11px] font-semibold">
                      {log.agent?.name || 'System'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-6 py-4 align-top">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => toggleExpand(log.id)}
                        className={`text-xs font-semibold px-3 py-1 rounded-xl border transition-colors flex items-center gap-1.5 ${
                          isExpanded
                            ? 'bg-slate-200 text-slate-800 border-slate-300'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200/60 shadow-2xs'
                        }`}
                      >
                        {isExpanded ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5 text-slate-600" /> Hide Details
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5 text-indigo-600" /> View Details ({keyCount} fields)
                          </>
                        )}
                      </button>

                      {isExpanded && (
                        <pre className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl border border-slate-800 overflow-x-auto max-w-lg shadow-inner">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {filteredLogs.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-center text-xs text-slate-400 font-medium py-14">
                  No audit logs matching search filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
