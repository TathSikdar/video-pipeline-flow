export function TaskProgress({ task }) {
  if (
    task.status !== 'downloading' &&
    task.status !== 'uploading' &&
    task.status !== 'preparing' &&
    task.status !== 'upload_queued' &&
    task.status !== 'completed'
  ) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Download Bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{task.downloadText || 'Downloading from YouTube'}</span>
          <span>{task.downloadPercent}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="bg-cyan-500 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${task.downloadPercent}%` }}
          ></div>
        </div>
      </div>

      {/* Upload Bar */}
      {!task.skipUpload && (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{task.uploadText || 'Uploading to Channel'}</span>
            <span>{task.uploadPercent}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${task.uploadPercent}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}
