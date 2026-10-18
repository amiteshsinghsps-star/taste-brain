import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Mail, HardDrive, MessageSquare, Cloud, FileText, Database, Globe, Upload, FileUp, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';

interface ConnectorsPageProps {
  sources: any[];
  handleConnectSource: (type: string, name: string, config?: Record<string, any>) => void;
  handleSyncSource: (id: string) => void;
  loadAllData: () => void;
}

export const ConnectorsPage: React.FC<ConnectorsPageProps> = ({
  sources,
  handleConnectSource,
  handleSyncSource,
  loadAllData,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedType, setSelectedType] = useState('UPLOAD');
  const [sourceName, setSourceName] = useState('');
  const [customConfig, setCustomConfig] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingSource, setDeletingSource] = useState<any>(null);
  const [connectorFlags, setConnectorFlags] = useState<{ liveConnectorsEnabled: boolean; banner: string } | null>(null);

  useEffect(() => {
    api
      .connectorStatus()
      .then((res: any) => setConnectorFlags({ liveConnectorsEnabled: !!res.liveConnectorsEnabled, banner: res.banner ?? '' }))
      .catch(() => setConnectorFlags({ liveConnectorsEnabled: false, banner: 'Could not read connector status from the API.' }));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSourceName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setUploadContent(text || '');
    };
    reader.readAsText(file);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceName.trim()) return;

    if (selectedType === 'UPLOAD') {
      if (!uploadContent.trim()) {
        alert('Please select a text/SOP file or paste document content.');
        return;
      }
      setLoading(true);
      try {
        await api.uploadDocument({ title: sourceName, content: uploadContent });
        await api.extractGraph();
        await api.extractSkills();
        loadAllData();
      } catch (err: any) {
        alert(err.message || 'Upload failed');
      } finally {
        setLoading(false);
        setShowAddModal(false);
        setSourceName('');
        setUploadContent('');
      }
    } else {
      const configPayload: Record<string, any> = {};
      if (selectedType === 'URL') {
        configPayload.url = customConfig;
      } else if (selectedType === 'DATABASE' || selectedType === 'GCS' || selectedType === 'FOLDER') {
        configPayload.pathOrUri = customConfig;
      }

      handleConnectSource(selectedType, sourceName, configPayload);
      setShowAddModal(false);
      setSourceName('');
      setCustomConfig('');
    }
  };

  const connectorTypes = [
    { type: 'UPLOAD', label: 'Upload File / SOP Text', icon: Upload, desc: 'Upload PDF, TXT, Markdown, or paste raw SOP guidelines directly' },
    { type: 'GMAIL', label: 'Gmail Inbox', icon: Mail, desc: 'Ingest company email threads, SOP updates, and customer communications' },
    { type: 'GDRIVE', label: 'Google Drive & Docs', icon: HardDrive, desc: 'Sync shared folders, PDF documents, and Google Docs SOPs' },
    { type: 'SLACK', label: 'Slack Channels', icon: MessageSquare, desc: 'Import channel announcements, incident notes, and operational logs' },
    { type: 'GCS', label: 'Google Cloud Storage (GCS)', icon: Cloud, desc: 'Connect GCS buckets for bulk document & file object ingestion' },
    { type: 'FOLDER', label: 'Local Document Folder & Files', icon: FileText, desc: 'Ingest local PDF, CSV, TXT, and Markdown files from disk' },
    { type: 'DATABASE', label: 'SQL Database Schema', icon: Database, desc: 'Ingest PostgreSQL, MySQL, Snowflake table schemas & dictionaries' },
    { type: 'URL', label: 'Web Page URL / Documentation', icon: Globe, desc: 'Fetch public HTML SOPs, knowledge base links, and Web docs' },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Data Sources & Connectors</h3>
          <p className="text-xs text-slate-500 mt-0.5">Upload SOP Files, Connect Gmail, Google Drive, Slack, GCS, SQL Databases, and Web Page URLs</p>
        </div>

        <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-sm">
          <Plus className="h-4 w-4 mr-1.5" /> Add New Data Source
        </Button>
      </div>

      {connectorFlags && !connectorFlags.liveConnectorsEnabled && (
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-200/90 bg-amber-50/70 text-xs text-amber-900">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="space-y-0.5">
            <p className="font-bold">Live connectors are OFF — this demo contains no real accounts or private data.</p>
            <p className="text-amber-800/90 leading-relaxed">
              Everything in the graph comes from the synthetic Northwind Logistics demo company and documents you paste or upload here.
              Gmail / Drive / Slack / database sync returns HTTP 403 until the operator sets <code className="font-mono">FF_LIVE_CONNECTORS=1</code>.
            </p>
          </div>
        </div>
      )}

      {/* Quick Access Source Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {connectorTypes.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.type}
              onClick={() => {
                setSelectedType(item.type);
                setSourceName(item.type === 'UPLOAD' ? 'Custom SOP Document.txt' : item.label);
                setShowAddModal(true);
              }}
              className="p-5 bg-white border border-slate-200/90 rounded-2xl hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between space-y-4"
            >
              <div className="flex items-start space-x-3.5">
                <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors shadow-xs">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-slate-900 group-hover:text-indigo-600 transition-colors leading-snug">{item.label}</h4>
                  <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-normal">{item.desc}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100/80 text-[11px] font-semibold text-indigo-600">
                <span>Connect Source</span>
                <Plus className="h-3.5 w-3.5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Connected Sources Table Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 bg-white">
          <h4 className="font-bold text-sm text-slate-900 tracking-tight">Active Connected Sources</h4>
        </div>
        <Table>
          <TableHeader className="bg-slate-50/40 border-b border-slate-100">
            <TableRow className="border-b border-slate-100 hover:bg-transparent">
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Source Name</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Type</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Status</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Last Synced</TableHead>
              <TableHead className="h-11 px-6 text-left align-middle font-bold text-xs text-slate-700">Ingested Docs</TableHead>
              <TableHead className="h-11 px-6 text-right align-middle font-bold text-xs text-slate-700">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((src) => (
              <TableRow key={src.id} className="border-b border-slate-100/80 hover:bg-slate-50/50 transition-colors">
                <TableCell className="px-6 py-4 font-bold text-xs text-slate-900">{src.name}</TableCell>
                <TableCell className="px-6 py-4"><Badge variant="outline" className="text-[11px] border-slate-200 bg-slate-50 text-slate-700">{src.type}</Badge></TableCell>
                <TableCell className="px-6 py-4">
                  <Badge variant={src.status === 'SUCCESS' ? 'success' : src.status === 'SYNCING' ? 'warning' : 'default'} className="text-[11px]">
                    {src.status}
                  </Badge>
                </TableCell>
                <TableCell className="px-6 py-4 text-xs text-slate-500 font-medium">
                  {src.lastSyncedAt ? new Date(src.lastSyncedAt).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell className="px-6 py-4 font-semibold text-xs text-slate-900">{src._count?.documents || 0} docs</TableCell>
                <TableCell className="px-6 py-4 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => handleSyncSource(src.id)} className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-slate-50">
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync Now
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeletingSource(src)}
                    className="h-8 text-xs font-semibold"
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sources.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center text-xs text-slate-400 font-medium py-14">
                  No data sources connected yet. Select a connector above to connect a source.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Confirm Delete Source Modal */}
      <ConfirmDialog
        isOpen={!!deletingSource}
        title="Delete Connected Data Source?"
        description={
          deletingSource
            ? `Are you sure you want to delete data source "${deletingSource.name}"? This will permanently remove its ingested documents and knowledge chunks.`
            : ''
        }
        onConfirm={() => {
          if (deletingSource) {
            api.deleteSource(deletingSource.id).then(loadAllData);
          }
        }}
        onClose={() => setDeletingSource(null)}
      />

      {/* Add New Data Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200/80">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Connect New Data Source</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 font-bold text-sm">✕</button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Source Type</label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="UPLOAD">📁 Direct File Upload / Paste SOP Text</option>
                  <option value="GMAIL">Gmail Inbox (OAuth)</option>
                  <option value="GDRIVE">Google Drive & Docs (OAuth)</option>
                  <option value="SLACK">Slack Channels (OAuth)</option>
                  <option value="GCS">Google Cloud Storage (Bucket)</option>
                  <option value="FOLDER">Local Document Folder / Files</option>
                  <option value="DATABASE">SQL Database Connection String</option>
                  <option value="URL">Web Page URL / HTML Documentation</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Document / Source Name</label>
                <Input
                  placeholder="e.g. Customs Clearance SOP 2026.pdf"
                  className="h-10 rounded-xl text-xs"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                />
              </div>

              {selectedType === 'UPLOAD' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Select Local File (TXT, MD, PDF, CSV, JSON)</label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer border border-slate-200">
                        <FileUp className="h-4 w-4 text-indigo-600" /> Choose File
                        <input type="file" accept=".txt,.md,.pdf,.json,.csv" onChange={handleFileChange} className="hidden" />
                      </label>
                      <span className="text-xs text-slate-500 truncate">{sourceName || 'No file chosen'}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Or Paste Document / SOP Content</label>
                    <textarea
                      rows={5}
                      placeholder="Paste your firm's SOP rules, denied-party screening guidelines, credit limits, or customs policies here..."
                      className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 font-mono"
                      value={uploadContent}
                      onChange={(e) => setUploadContent(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                (selectedType === 'GCS' || selectedType === 'DATABASE' || selectedType === 'FOLDER' || selectedType === 'URL') && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      {selectedType === 'URL'
                        ? 'Web Page Target URL'
                        : selectedType === 'DATABASE'
                        ? 'Connection String'
                        : selectedType === 'GCS'
                        ? 'Bucket URI'
                        : 'Folder Path'}
                    </label>
                    <Input
                      className="h-10 rounded-xl font-mono text-xs"
                      placeholder={
                        selectedType === 'URL'
                          ? 'https://docs.company.com/shipping-sops'
                          : selectedType === 'DATABASE'
                          ? 'postgresql://user:pass@host:5432/dbname'
                          : selectedType === 'GCS'
                          ? 'gs://company-sop-bucket'
                          : '/path/to/documents'
                      }
                      value={customConfig}
                      onChange={(e) => setCustomConfig(e.target.value)}
                    />
                  </div>
                )
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-5 py-2 rounded-xl font-medium">
                  {loading ? 'Ingesting...' : 'Ingest Document'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
