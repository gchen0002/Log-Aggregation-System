'use client';

import { useState } from 'react';

interface LogSearchProps {
  onSearch: (query: string, filters: Record<string, string>) => void;
  loading: boolean;
}

export default function LogSearch({ onSearch, loading }: LogSearchProps) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const filters: Record<string, string> = {};
    if (level) filters.level = level;
    if (source) filters.source = source;
    onSearch(query, filters);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-4 items-end">
      <div className="flex-1">
        <label className="block text-sm mb-1">Search</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search logs..."
          className="w-full px-3 py-2 border rounded"
        />
      </div>
      <div>
        <label className="block text-sm mb-1">Level</label>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="px-3 py-2 border rounded"
        >
          <option value="">All</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
