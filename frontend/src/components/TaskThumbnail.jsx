export function TaskThumbnail({ task, videoId }) {
  if (task.status !== 'completed' && !task.localFile) return null;

  return (
    <a
      href={`http://localhost:8000/api/download/${task.localFile}?title=${encodeURIComponent(task.title || 'TubeSync Video')}`}
      download={`${task.title || 'TubeSync Video'}.mp4`}
      className="w-full md:w-[40%] relative aspect-video rounded-xl overflow-hidden bg-gray-900 border border-gray-700/50 group block shadow-lg cursor-pointer shrink-0 animate-fade-in-up"
    >
      <img
        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
        alt="Thumbnail"
        className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105 opacity-60 group-hover:opacity-40"
      />

      {/* Overlay Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 transition-all duration-300">
        <div className="w-12 h-12 rounded-full bg-transparent text-white flex items-center justify-center mb-2 border-2 border-white backdrop-blur-[2px] shadow-lg group-hover:bg-white/10 group-hover:scale-110 transition-all duration-300">
          <svg className="w-6 h-6 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
        <span className="font-bold text-white tracking-wide text-sm drop-shadow-md transition-all duration-300">
          Local Download
        </span>
      </div>
    </a>
  );
}
