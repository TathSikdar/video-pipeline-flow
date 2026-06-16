import { TaskThumbnail } from './TaskThumbnail';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskProgress } from './TaskProgress';

export function TaskItem({ task }) {
  const extractVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:v=|\/v\/|youtu\.be\/|shorts\/|embed\/|^)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const videoId = extractVideoId(task.url);

  return (
    <div className="glass-card p-6 border-l-4 border-l-cyan-500 transition-all flex flex-col md:flex-row gap-6 animate-fade-in-up">
      <TaskThumbnail task={task} videoId={videoId} />

      {/* Right Side: Details & Progress */}
      <div className="flex-1 w-full flex flex-col min-w-0">
        <div className="flex justify-between items-start mb-4 gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-medium text-white flex items-center gap-2">
              <span className="truncate" title={task.title || task.url}>
                {task.title || task.url}
              </span>
            </h3>
            <p className="text-sm text-gray-400 mt-1 truncate" title={task.title ? task.url : ''}>
              {task.title ? task.url : 'No custom title provided'}
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <TaskStatusBadge status={task.status} />
            <span className="px-3 py-1 rounded-full text-[10px] font-medium border border-gray-600/50 text-gray-400 bg-transparent uppercase tracking-wider">
              {task.resolution}p
            </span>
          </div>
        </div>

        <TaskProgress task={task} />

        {/* Reupload Link */}
        {(task.status === 'completed' || task.localFile) && (
          <div className="mt-auto">
            {task.status === 'completed' && task.watchUrl ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/40 border border-gray-700/50 group hover:border-gray-600 transition-colors">
                <span className="text-gray-300 text-sm truncate mr-4">{task.watchUrl}</span>
                <a
                  href={task.watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 text-sm font-medium hover:text-cyan-300 whitespace-nowrap"
                >
                  Open &rarr;
                </a>
              </div>
            ) : (
              <div className="flex items-center p-3 rounded-lg bg-gray-900/40 border border-gray-700/50">
                <span className="text-gray-500 text-sm italic truncate flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-gray-600/30 border-t-gray-500 rounded-full animate-spin"></div>
                  Processing Reupload Link...
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error Message */}
        {task.status === 'error' && (
          <div className="mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {task.errorMessage || 'An unknown error occurred during transfer.'}
          </div>
        )}
      </div>
    </div>
  );
}
