import React, { useState } from 'react';
import { Share2, Search, Filter } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface KnowledgeGraphPageProps {
  graphData: any;
  loadAllData: () => void;
}

export const KnowledgeGraphPage: React.FC<KnowledgeGraphPageProps> = ({
  graphData,
  loadAllData,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedRelType, setSelectedRelType] = useState('ALL');
  const [loading, setLoading] = useState(false);

  const handleReExtract = async () => {
    setLoading(true);
    try {
      await api.extractGraph();
      loadAllData();
    } finally {
      setLoading(false);
    }
  };

  const links = graphData.links || [];

  const filteredLinks = links.filter((link: any) => {
    const matchesSearch =
      !filterQuery ||
      link.sourceName?.toLowerCase().includes(filterQuery.toLowerCase()) ||
      link.targetName?.toLowerCase().includes(filterQuery.toLowerCase()) ||
      link.relationType?.toLowerCase().includes(filterQuery.toLowerCase());

    const matchesRel = selectedRelType === 'ALL' || link.relationType === selectedRelType;
    return matchesSearch && matchesRel;
  });

  const relationTypes = ['ALL', 'VALIDATES', 'REQUIRES', 'APPROVES', 'GOVERNS'];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Knowledge Graph Explorer</h3>
          <p className="text-xs text-slate-500 mt-0.5">Structured entities and multi-hop relations extracted from company SOPs</p>
        </div>
        <Button size="sm" onClick={handleReExtract} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-4 py-2 font-medium shadow-xs">
          <Share2 className="h-4 w-4 mr-1.5" /> {loading ? 'Extracting Graph...' : 'Re-extract Knowledge Graph'}
        </Button>
      </div>

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-6">
        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-indigo-50/80 border border-indigo-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">Total Entities</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{graphData.nodes?.length || 0}</p>
          </div>
          <div className="p-4 bg-emerald-50/80 border border-emerald-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Relation Edges</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{graphData.links?.length || 0}</p>
          </div>
          <div className="p-4 bg-purple-50/80 border border-purple-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider block">Multi-hop Paths</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">Multi-hop Active</p>
          </div>
        </div>

        {/* Live Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative flex-1 w-full">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
            <Input
              placeholder="Search entities, SOP rules, or relations..."
              className="pl-9 h-10 rounded-xl text-xs bg-slate-50 border-slate-200"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1" />
            {relationTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedRelType(type)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors shrink-0 ${
                  selectedRelType === type
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Relation Links Display */}
        <div className="border border-slate-200/90 rounded-2xl p-5 bg-slate-50/40 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Extracted Relations & Typed Links ({filteredLinks.length})</h4>
          </div>
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {filteredLinks.map((link: any) => (
              <div key={link.id} className="p-4 bg-white border border-slate-200/90 rounded-2xl text-xs flex items-center justify-between shadow-2xs hover:border-indigo-300 transition-colors">
                <span className="font-bold text-slate-900">{link.sourceName}</span>
                <Badge variant="outline" className="font-mono text-[10px] bg-slate-50 border-slate-200 text-indigo-700 px-3 py-1">{link.relationType}</Badge>
                <span className="font-bold text-indigo-600">{link.targetName}</span>
              </div>
            ))}

            {filteredLinks.length === 0 && (
              <div className="text-center text-xs text-slate-400 font-medium py-10">
                No matching relations found. Try adjusting your search query or relation filter.
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
