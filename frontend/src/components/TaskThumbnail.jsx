export function TaskThumbnail({ task, videoId }) {
  const isCompleted = task.status === 'completed' || task.localFile;

  const content = (
    <>
      <img
        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
        alt="Thumbnail"
        className={`w-full h-full object-cover transition-all duration-700 ${isCompleted ? 'group-hover:scale-105 opacity-60 group-hover:opacity-40' : 'opacity-30 grayscale blur-sm'}`}
      />

      {/* Overlay Content */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center p-4 transition-all duration-500 ${isCompleted ? 'opacity-100' : 'opacity-0'}`}>
        <div className="w-12 h-12 rounded-full bg-transparent text-white flex items-center justify-center border-2 border-white backdrop-blur-[2px] shadow-lg group-hover:bg-white/10 group-hover:scale-110 transition-all duration-300">
          <svg className="w-6 h-6 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
      </div>
    </>
  );

  const containerClasses = "w-full md:w-[40%] relative aspect-video rounded-xl overflow-hidden bg-gray-900 border border-gray-700/50 group block shadow-lg shrink-0 transition-all duration-500";

  if (isCompleted) {
    return (
      <a
        href={`http://localhost:8000/api/download/${task.localFile}?title=${encodeURIComponent(task.title || 'TransferTube Video')}`}
        download={`${task.title || 'TransferTube Video'}.mp4`}
        className={`${containerClasses} cursor-pointer`}
      >
        {content}
      </a>
    );
  }

  return (
    <div className={containerClasses}>
      {content}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
      </div>
    </div>
  );
}
