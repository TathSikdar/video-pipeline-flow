export function TaskStatusBadge({ status }) {
  switch (status) {
    case 'queued': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-300">Queued</span>;
    case 'preparing': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Preparing...</span>;
    case 'downloading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">Downloading</span>;
    case 'uploading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">Uploading</span>;
    case 'completed': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-400">Completed</span>;
    case 'error': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400">Failed</span>;
    default: return null;
  }
}
