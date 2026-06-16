import { useState } from 'react';
import { TaskThumbnail } from './TaskThumbnail';
import { TaskStatusBadge } from './TaskStatusBadge';
import { TaskProgress } from './TaskProgress';

export function TaskItem({ task, pulse, onRemove }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (url) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extractVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:v=|\/v\/|youtu\.be\/|shorts\/|embed\/|^)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const videoId = extractVideoId(task.url);

  return (
    <div className="animate-fade-in-up">
      <div className={`glass-card p-6 border-l-4 transition-all duration-300 flex flex-col md:flex-row gap-6 ${pulse ? 'animate-shake border-l-rose-500' : 'border-l-cyan-500'}`}>
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
              <div className="flex items-center gap-3">
                <TaskStatusBadge status={task.status} />
                {task.status !== 'completed' && (
                  <button
                    onClick={() => onRemove && onRemove(task.id)}
                    className="text-gray-500 hover:text-rose-400 transition-colors p-1 rounded-full hover:bg-gray-800"
                    title="Cancel Task"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <span className="px-3 py-1 rounded-full text-[10px] font-medium border border-gray-600/50 text-gray-400 bg-transparent uppercase tracking-wider">
                {task.resolution}p
              </span>
            </div>
          </div>

          <TaskProgress task={task} />

          <div className="mt-auto pt-4 flex flex-col justify-end gap-2 transition-all duration-500">
            {/* Reupload Link or Download File */}
            {(task.status === 'completed' || task.localFile) && (
              <div>
                {task.skipUpload ? (
                  task.status === 'completed' && task.localFile ? (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/40 border border-gray-700/50 group hover:border-gray-600 transition-colors animate-fade-in-up">
                      <span className="text-gray-300 text-sm truncate mr-4">Ready for Download</span>
                      <a
                        href={`http://localhost:8000/api/download/${task.localFile}?title=${encodeURIComponent(task.title || '')}`}
                        download
                        className="text-cyan-400 text-sm font-medium hover:text-cyan-300 whitespace-nowrap"
                      >
                        Download File &darr;
                      </a>
                    </div>
                  ) : null
                ) : (
                  task.status === 'completed' && task.watchUrl ? (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/40 border border-gray-700/50 group hover:border-gray-600 transition-colors animate-fade-in-up">
                      <div className="flex items-center gap-3 overflow-hidden mr-4">
                        <button
                          onClick={() => handleCopy(task.watchUrl)}
                          className="text-gray-500 hover:text-cyan-400 p-1.5 rounded-md hover:bg-gray-800 transition-colors shrink-0"
                          title="Copy to clipboard"
                        >
                          {copied ? (
                            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          )}
                        </button>
                        <span className="text-gray-300 text-sm truncate">{task.watchUrl}</span>
                      </div>
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
                    <div className="flex items-center p-3 rounded-lg bg-gray-900/40 border border-gray-700/50 animate-fade-in-up">
                      <span className="text-gray-500 text-sm italic truncate flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-gray-600/30 border-t-gray-500 rounded-full animate-spin"></div>
                        Processing Reupload Link...
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* Error Message */}
          {task.status === 'error' && (
            <div className="mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
              {task.errorMessage || 'An unknown error occurred during transfer.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
