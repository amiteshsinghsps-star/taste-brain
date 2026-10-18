import React, { useState } from 'react';
import { Mail, Send, CheckCircle, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { api } from '@/lib/api';

interface EmailDeskPageProps {
  emails: any[];
  handleApproveEmail: (id: string) => void;
  loadAllData: () => void;
}

export const EmailDeskPage: React.FC<EmailDeskPageProps> = ({
  emails,
  handleApproveEmail,
  loadAllData,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);

  const triggerSimulatedEmail = (type: 'CUSTOMS' | 'BILLING') => {
    const payload =
      type === 'CUSTOMS'
        ? {
            senderEmail: 'import@freightco.com',
            subject: 'Customs Delay Inquiry - Container BKG-889',
            body: 'Please confirm our container clearance status at Hamburg Port and estimated release time.',
          }
        : {
            senderEmail: 'accounts@globaltraders.com',
            subject: 'Invoice #INV-2026-904 Credit Limit Check',
            body: 'Requesting verification of credit limit approval for invoice #INV-2026-904 under accounts payable SOP.',
          };

    api.triageEmail(payload).then(loadAllData);
  };

  const handleCustomEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderEmail || !subject || !body) return;

    setLoading(true);
    try {
      await api.triageEmail({ senderEmail, subject, body });
      setIsModalOpen(false);
      setSenderEmail('');
      setSubject('');
      setBody('');
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to triage email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Email Desk Triage & Approval Engine</h3>
          <p className="text-xs text-slate-500 mt-0.5">Inbox triage → category classification → grounded cited draft → human approve & send</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-3.5 py-2 rounded-xl shadow-xs"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Compose & Triage Email
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerSimulatedEmail('CUSTOMS')}
            className="border-slate-200 text-slate-700 font-medium text-xs px-3 py-2 rounded-xl"
          >
            + Quick Preset: Customs
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerSimulatedEmail('BILLING')}
            className="border-slate-200 text-slate-700 font-medium text-xs px-3 py-2 rounded-xl"
          >
            + Quick Preset: Billing
          </Button>
        </div>
      </div>

      {/* Main Email Desk Table Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 bg-white flex items-center justify-between">
          <h4 className="font-bold text-sm text-slate-900 tracking-tight flex items-center gap-2">
            <Mail className="h-4 w-4 text-indigo-600" /> Triaged Inbox Messages ({emails.length})
          </h4>
          <span className="text-xs text-slate-400 font-medium">Copilot Approval Active</span>
        </div>
        <Table>
          <TableHeader className="bg-slate-50/40 border-b border-slate-100">
            <TableRow className="border-b border-slate-100 hover:bg-transparent">
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Sender</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Subject</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Category</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Cited Draft Response</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Status</TableHead>
              <TableHead className="h-11 px-6 text-right align-middle font-bold text-xs text-slate-700">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.map((msg) => (
              <TableRow key={msg.id} className="border-b border-slate-100/80 hover:bg-slate-50/50 transition-colors">
                <TableCell className="px-6 py-4 font-bold text-xs text-slate-900">{msg.senderEmail}</TableCell>
                <TableCell className="px-6 py-4 text-xs font-semibold text-slate-800">{msg.subject}</TableCell>
                <TableCell className="px-6 py-4"><Badge variant="outline" className="text-[11px] bg-slate-50 border-slate-200 text-slate-700">{msg.category}</Badge></TableCell>
                <TableCell className="px-6 py-4 text-xs max-w-sm text-slate-600 space-y-1">
                  <p className="truncate font-medium">{msg.citedDraft}</p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                    🤖 Customer Email Agent
                  </span>
                </TableCell>
                <TableCell className="px-6 py-4">
                  <Badge variant={msg.status === 'SENT' ? 'success' : 'warning'} className="text-[11px]">
                    {msg.status}
                  </Badge>
                </TableCell>
                <TableCell className="px-6 py-4 text-right">
                  {msg.status !== 'SENT' ? (
                    <Button size="sm" onClick={() => handleApproveEmail(msg.id)} className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3.5">
                      <Send className="h-3.5 w-3.5 mr-1.5" /> Approve & Send
                    </Button>
                  ) : (
                    <span className="text-xs text-emerald-600 font-semibold flex items-center justify-end">
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approved & Sent
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {emails.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center text-xs text-slate-400 font-medium py-14">
                  No triaged emails in inbox. Click 'Compose & Triage Email' above to submit an email.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Compose & Triage Email Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg bg-white rounded-2xl p-6 border border-slate-200 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <Mail className="h-5 w-5 text-indigo-600" /> Compose & Triage Custom Email
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCustomEmailSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Sender Email</label>
                <Input
                  required
                  type="email"
                  placeholder="e.g. logistics@clientfirm.com"
                  className="h-10 rounded-xl"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Email Subject Line</label>
                <Input
                  required
                  placeholder="e.g. Mandatory Tariff Declaration & HS Code Verification"
                  className="h-10 rounded-xl"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Email Content / Query Body</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Type full email body text here..."
                  className="w-full p-3 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className="rounded-xl text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-5">
                  {loading ? 'Triaging Email...' : 'Submit & Triage Email'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
