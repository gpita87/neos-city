import { useEffect, useState } from 'react';
import { getOrganizers, addOrganizer, deleteOrganizer, batchImportTournaments, syncTournaments } from '../lib/api';
import { formatDate } from '../lib/utils';

const SERIES_COLORS = {
  ffc:    'bg-purple-900/40 text-purple-300 border-purple-700/50',
  rtg_na: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  rtg_eu: 'bg-green-900/40 text-green-300 border-green-700/50',
  dcm:    'bg-orange-900/40 text-orange-300 border-orange-700/50',
  tcc:    'bg-pink-900/40 text-pink-300 border-pink-700/50',
  eotr:   'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  other:  'bg-slate-800/40 text-slate-400 border-slate-600/50',
};

export default function Organizers() {
  const [organizers, setOrganizers]   = useState([]);
  const [username, setUsername]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [notes, setNotes]             = useState('');
  const [subdomain, setSubdomain]       = useState('');
  const [slugPatterns, setSlugPatterns] = useState('');
  const [adding, setAdding]             = useState(false);

  // Batch import state
  const [batchUrls, setBatchUrls]       = useState('');
  const [importing, setImporting]       = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Auto-sync state
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const handleSync = async () => {
    if (!confirm(`Scan all ${organizers.length} organizer profile(s) and import new Pokken tournaments? This may take a minute.`)) return;
    setSyncing(true);
    setSyncResult(null);
    setImportResult(null);
    try {
      const result = await syncTournaments();
      setSyncResult(result);
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setSyncing(false);
    }
  };

  const load = () => getOrganizers().then(setOrganizers).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setAdding(true);
    try {
      await addOrganizer({
        challonge_username: username.trim(),
        display_name: displayName.trim() || null,
        notes: notes.trim() || null,
        challonge_subdomain: subdomain.trim() || null,
        slug_patterns: slugPatterns.trim() || null,
      });
      setUsername(''); setDisplayName(''); setNotes(''); setSubdomain(''); setSlugPatterns('');
      load();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove ${name} from the organizer pool?`)) return;
    await deleteOrganizer(id).then(load).catch(console.error);
  };

  const handleBatchImport = async () => {
    const urls = batchUrls
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (urls.length === 0) return;

    setImporting(true);
    setImportResult(null);
    try {
      const result = await batchImportTournaments(urls);
      setImportResult(result);
      if (result.imported > 0) setBatchUrls('');
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-widest text-white">ORGANIZER POOL</h1>
          <p className="text-slate-500 text-sm mt-1">
            Track tournament organizers and import their events into Neos City.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || organizers.length === 0}
          className="text-sm px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white font-medium transition-colors"
        >
          {syncing ? '⏳ Scanning…' : '🔄 Sync All Organizers'}
        </button>
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className="bg-[#0c1425] border border-green-700/50 rounded-xl p-5">
          <h2 className="font-display text-sm tracking-widest text-green-400 mb-3">SYNC COMPLETE</h2>
          <p className="text-white text-sm">
            ✅ <strong>{syncResult.imported}</strong> imported &nbsp;·&nbsp;
            ⏭️ <strong>{syncResult.skipped}</strong> already in DB
            {syncResult.errors > 0 && <> &nbsp;·&nbsp; ❌ <strong>{syncResult.errors}</strong> errors</>}
          </p>
          {syncResult.detail?.imported?.length > 0 && (
            <div className="mt-3 space-y-1">
              {syncResult.detail.imported.map(t => (
                <div key={t.slug} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className={`px-2 py-0.5 rounded border ${SERIES_COLORS[t.series] || SERIES_COLORS.other}`}>
                    {t.series.toUpperCase()}
                  </span>
                  <span>{t.name || t.slug}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Batch import ── */}
      <div className="bg-[#0c1425] border border-cyan-700/40 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-1">IMPORT TOURNAMENTS</h2>
          <p className="text-slate-500 text-xs">
            Paste Challonge tournament URLs — one per line or comma-separated. Works with any public
            tournament: <span className="text-slate-400">challonge.com/ffc12</span> or the full URL.
          </p>
        </div>
        <textarea
          value={batchUrls}
          onChange={e => setBatchUrls(e.target.value)}
          placeholder={`https://challonge.com/ffc12\nhttps://challonge.com/rtgna5\nhttps://challonge.com/dcm3`}
          rows={5}
          className="w-full bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono resize-y"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-600">
            {batchUrls.split(/[\n,]+/).filter(s => s.trim()).length} URL(s) detected
          </p>
          <button
            onClick={handleBatchImport}
            disabled={importing || !batchUrls.trim()}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {importing ? 'Importing…' : '⚡ Import Tournaments'}
          </button>
        </div>

        {/* Import result */}
        {importResult && (
          <div className={`rounded-lg p-4 border text-sm space-y-2 ${
            importResult.errors > 0
              ? 'bg-yellow-900/20 border-yellow-700/40'
              : 'bg-green-900/20 border-green-700/40'
          }`}>
            <p className="text-white font-medium">
              ✅ <strong>{importResult.imported}</strong> imported
              {importResult.skipped > 0 && <> · ⏭️ <strong>{importResult.skipped}</strong> already in DB</>}
              {importResult.errors > 0 && <> · ❌ <strong>{importResult.errors}</strong> failed</>}
            </p>
            {importResult.detail?.imported?.length > 0 && (
              <div className="space-y-1 pt-1">
                {importResult.detail.imported.map(t => (
                  <div key={t.slug} className="flex items-center gap-2 text-xs text-slate-300">
                    <span className="text-green-400">✓</span>
                    <span>{t.name || t.slug}</span>
                  </div>
                ))}
              </div>
            )}
            {importResult.detail?.errors?.length > 0 && (
              <div className="space-y-1 pt-1">
                {importResult.detail.errors.map(e => (
                  <div key={e.slug} className="flex items-center gap-2 text-xs text-red-400">
                    <span>✗</span>
                    <span>{e.slug}: {e.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add organizer ── */}
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl p-5">
        <h2 className="font-display text-sm tracking-widest text-cyan-400 mb-1">ORGANIZER POOL</h2>
        <p className="text-slate-500 text-xs mb-4">
          Track who runs the Pokkén scene — for records and attribution.
        </p>
        <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Challonge username *"
            className="flex-1 min-w-40 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="flex-1 min-w-40 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. FFC host"
            className="flex-1 min-w-40 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={subdomain}
            onChange={e => setSubdomain(e.target.value)}
            placeholder="Community subdomain (optional)"
            title="If this organizer hosts tournaments under a Challonge community subdomain (e.g. 'ffc' for ffc.challonge.com), enter it here."
            className="flex-1 min-w-40 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <input
            value={slugPatterns}
            onChange={e => setSlugPatterns(e.target.value)}
            placeholder="Slug patterns e.g. ffc,rtgna"
            title="Comma-separated slug prefixes for enumeration. Sync will probe prefix+N (e.g. ffc1, ffc2…) via the API to find tournaments without scraping."
            className="flex-1 min-w-40 bg-[#050a18] border border-[#1a2744] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            disabled={adding || !username.trim()}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>

      {/* ── Organizer list ── */}
      <div className="bg-[#0c1425] border border-[#1a2744] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#1a2744]">
          <h2 className="font-display text-sm tracking-widest text-cyan-400">TRACKED ORGANIZERS</h2>
        </div>
        {organizers.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">
            No organizers yet. Add Challonge usernames above.
          </p>
        ) : (
          <div className="divide-y divide-[#1a2744]">
            {organizers.map(o => (
              <div key={o.id} className="flex items-center gap-4 px-5 py-3">
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">{o.display_name || o.challonge_username}</p>
                  <p className="text-slate-500 text-xs">
                    @{o.challonge_username}
                    {o.notes ? ` · ${o.notes}` : ''}
                    {o.challonge_subdomain ? <span className="ml-1 text-cyan-400" title="Community subdomain configured"> · 🏘 {o.challonge_subdomain}</span> : ''}
                    {o.slug_patterns ? <span className="ml-1 text-cyan-400" title="Slug enumeration patterns"> · 🔢 {o.slug_patterns}</span> : ''}
                  </p>
                </div>
                <p className="text-xs text-slate-600">
                  {o.last_synced_at ? `Synced ${formatDate(o.last_synced_at)}` : 'Never synced'}
                </p>
                <button
                  onClick={() => handleDelete(o.id, o.display_name || o.challonge_username)}
                  className="text-slate-600 hover:text-red-400 text-xs transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
